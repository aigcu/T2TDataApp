"""
EEG-to-Text model: EEGConformer architecture.

Pipeline:
  EEGNetFeatureExtractor (+ SE channel attention)
    → Linear projection → 4× ConformerBlock → mean-pool → Linear head

Loss (per 2024-2025 imagined-speech research consensus):
  - Single-word classification = many-to-one problem: 32 frames → 1 label
  - Use CrossEntropy with label smoothing (0.1) OR FocalLoss (gamma=2)
  - CTC is NOT appropriate: it is for sequence-to-sequence (many frames → many tokens)
    and forces 31/32 frames to predict "blank", poisoning the gradient for classification.

Preprocessing (applied inside RealEEGDataset):
  CAR → Bandpass 0.5–40 Hz → Notch 60 Hz → Artifact rejection (±100 µV)

Augmentation (applied per-batch in training loop):
  Channel dropout, Gaussian noise, Amplitude scaling, Time shifting,
  Frequency-band dropout (new — zeros a random theta/alpha/beta band)

Inference:
  Mean-pool logits across all T time steps → softmax → argmax
  (Consistent with how the model is trained: CE on mean-pooled logits)
"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Vocabulary ────────────────────────────────────────────────────────────────

VOCAB = ["<blank>", "yes", "no", "help", "stop", "go", "water", "food", "pain", "more", "need"]
VOCAB_SIZE = len(VOCAB)  # 11  (index 0 = unused padding; classes 1-10)
EOS_TOKEN = 0  # padding / ignore index for CE loss

WORD_NAME_TO_ID = {
    "YES": 1, "NO": 2, "HELP": 3, "STOP": 4, "GO": 5,
    "WATER": 6, "FOOD": 7, "PAIN": 8, "MORE": 9, "NEED": 10,
}

CHECKPOINT_DIR = os.path.dirname(__file__)
CHECKPOINT_PATH = os.path.join(CHECKPOINT_DIR, "model_checkpoint.pth")   # legacy alias
BEST_CHECKPOINT_PATH = os.path.join(CHECKPOINT_DIR, "model_best.pth")
LATEST_CHECKPOINT_PATH = os.path.join(CHECKPOINT_DIR, "model_latest.pth")

# Frequency-band boundaries in FFT bins for 125 Hz / 256 samples
# bin_k corresponds to frequency k * 125/256 Hz
# Theta 4-8 Hz → bins 8-16 | Alpha 8-13 Hz → bins 16-26 | Beta 13-30 Hz → bins 26-61
_FREQ_BANDS = [(8, 16), (16, 26), (26, 61)]


# ── Squeeze-and-Excitation Channel Attention ──────────────────────────────────

class _SqueezeExcitation(nn.Module):
    """
    Channel attention for EEG: learns which of the 16 scalp channels
    carry the most task-relevant information (e.g. Broca/Wernicke areas).

    Input/output: (B, C, T)
    """

    def __init__(self, channels: int, reduction: int = 4) -> None:
        super().__init__()
        hidden = max(channels // reduction, 4)
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.fc = nn.Sequential(
            nn.Linear(channels, hidden),
            nn.ReLU(),
            nn.Linear(hidden, channels),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        w = self.pool(x).squeeze(-1)       # (B, C)
        w = self.fc(w).unsqueeze(-1)       # (B, C, 1)
        return x * w


# ── EEGNet Feature Extractor ──────────────────────────────────────────────────

class EEGNetFeatureExtractor(nn.Module):
    """
    EEGNet-inspired depthwise separable CNN with Squeeze-and-Excitation channel attention.

    Kernel sizes are tuned for 125 Hz (OpenBCI Cyton+Daisy):
      kern_length=64 → 512ms receptive field (standard for 125 Hz)

    Input:  (B, Chans, Samples)  — raw EEG
    Output: (B, T_out, F2)       — T_out=32 temporal frames, F2=16 features
    """

    def __init__(
        self,
        chans: int = 16,
        samples: int = 256,
        kern_length: int = 64,     # 512ms at 125 Hz — correct for this hardware
        F1: int = 8,
        D: int = 2,
        F2: int = 16,
        dropout_rate: float = 0.25,  # increased from 0.2 for small-data regime
    ) -> None:
        super().__init__()
        self.F2 = F2

        # Block 1: temporal convolution (learns frequency filters)
        self.conv1 = nn.Conv2d(1, F1, (1, kern_length), padding=(0, kern_length // 2), bias=False)
        self.bn1 = nn.BatchNorm2d(F1, affine=False)

        # Block 2: depthwise spatial convolution (learns spatial filters per channel)
        self.dw_conv = nn.Conv2d(F1, F1 * D, (chans, 1), groups=F1, bias=False)
        self.bn2 = nn.BatchNorm2d(F1 * D)
        self.pool2 = nn.AvgPool2d((1, 4))
        self.drop2 = nn.Dropout(dropout_rate)
        self.se = _SqueezeExcitation(F1 * D)   # channel attention after spatial mixing

        # Block 3: separable (pointwise) convolution
        self.sep_conv = nn.Conv2d(F1 * D, F2, (1, 8), padding=(0, 4), bias=False)
        self.bn3 = nn.BatchNorm2d(F2)
        self.pool3 = nn.AvgPool2d((1, 2))
        self.drop3 = nn.Dropout(dropout_rate)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.unsqueeze(1)                             # (B, 1, C, T)
        x = F.elu(self.bn1(self.conv1(x)))             # (B, F1, C, T)
        x = F.elu(self.bn2(self.dw_conv(x)))           # (B, F1*D, 1, T)
        x = self.drop2(self.pool2(x))                  # (B, F1*D, 1, T/4)

        # SE channel attention: squeeze spatial dim, attend, restore
        x = self.se(x.squeeze(2)).unsqueeze(2)         # (B, F1*D, 1, T/4)

        x = F.elu(self.bn3(self.sep_conv(x)))          # (B, F2, 1, T/4)
        x = self.drop3(self.pool3(x))                  # (B, F2, 1, T/8)
        x = x.squeeze(2).permute(0, 2, 1)             # (B, T_out, F2)
        return x


# ── Conformer Building Blocks ─────────────────────────────────────────────────

class _FeedForwardModule(nn.Module):
    def __init__(self, d_model: int, expansion: int = 4, dropout: float = 0.1) -> None:
        super().__init__()
        self.norm = nn.LayerNorm(d_model)
        self.fc1 = nn.Linear(d_model, d_model * expansion)
        self.fc2 = nn.Linear(d_model * expansion, d_model)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.drop(self.fc2(self.drop(F.silu(self.fc1(self.norm(x))))))


class _ConvModule(nn.Module):
    def __init__(self, d_model: int, kernel_size: int = 31, dropout: float = 0.1) -> None:
        super().__init__()
        assert (kernel_size - 1) % 2 == 0, "kernel_size must be odd"
        pad = (kernel_size - 1) // 2
        self.norm = nn.LayerNorm(d_model)
        self.pw1 = nn.Conv1d(d_model, 2 * d_model, 1)
        self.dw = nn.Conv1d(d_model, d_model, kernel_size, padding=pad, groups=d_model)
        self.bn = nn.BatchNorm1d(d_model)
        self.pw2 = nn.Conv1d(d_model, d_model, 1)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        r = self.norm(x).permute(0, 2, 1)
        r = self.pw1(r)
        r, gate = r.chunk(2, dim=1)
        r = r * torch.sigmoid(gate)                    # gated linear unit
        r = F.silu(self.bn(self.dw(r)))
        r = self.drop(self.pw2(r))
        return r.permute(0, 2, 1)


class ConformerBlock(nn.Module):
    """FF½ → MHSA → Conv → FF½ → LayerNorm"""

    def __init__(
        self,
        d_model: int = 128,
        num_heads: int = 4,
        ff_expansion: int = 4,
        conv_kernel: int = 31,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.ff1 = _FeedForwardModule(d_model, ff_expansion, dropout)
        self.attn_norm = nn.LayerNorm(d_model)
        self.attn = nn.MultiheadAttention(d_model, num_heads, dropout=dropout, batch_first=True)
        self.attn_drop = nn.Dropout(dropout)
        self.conv = _ConvModule(d_model, conv_kernel, dropout)
        self.ff2 = _FeedForwardModule(d_model, ff_expansion, dropout)
        self.final_norm = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + 0.5 * self.ff1(x)
        normed = self.attn_norm(x)
        attn_out, _ = self.attn(normed, normed, normed)
        x = x + self.attn_drop(attn_out)
        x = x + self.conv(x)
        x = x + 0.5 * self.ff2(x)
        return self.final_norm(x)


# ── Main Model ────────────────────────────────────────────────────────────────

class EEGConformerModel(nn.Module):
    """
    EEGConformer for single-word imagined speech classification.

    Architecture:
      EEGNet (+ SE attention) → projection → 4× Conformer → mean-pool → Linear head

    Forward returns: logits (B, vocab_size)
      Mean-pooling over the T time dimension before the classifier.
      This matches how the model is evaluated: one prediction per EEG window.
    """

    def __init__(
        self,
        chans: int = 16,
        samples: int = 256,
        d_model: int = 128,
        num_conformer_blocks: int = 4,
        vocab_size: int = VOCAB_SIZE,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.vocab_size = vocab_size
        self.eegnet = EEGNetFeatureExtractor(chans=chans, samples=samples)
        self.proj = nn.Linear(self.eegnet.F2, d_model)
        self.conformer = nn.ModuleList([
            ConformerBlock(d_model=d_model, dropout=dropout)
            for _ in range(num_conformer_blocks)
        ])
        self.norm = nn.LayerNorm(d_model)
        self.drop_cls = nn.Dropout(dropout)
        self.head = nn.Linear(d_model, vocab_size)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, Chans, Samples) raw EEG
        Returns:
            logits: (B, vocab_size)  — one prediction per window
        """
        feat = self.eegnet(x)                          # (B, T, F2)
        feat = self.proj(feat)                         # (B, T, d_model)
        for block in self.conformer:
            feat = block(feat)
        feat = self.norm(feat)                         # (B, T, d_model)
        feat = feat.mean(dim=1)                        # (B, d_model)  ← mean pool over time
        feat = self.drop_cls(feat)
        logits = self.head(feat)                       # (B, vocab_size)
        return logits


# ── Focal Loss ────────────────────────────────────────────────────────────────

class FocalLoss(nn.Module):
    """
    Focal Loss (Lin et al. 2017) with optional label smoothing.

    Focuses training on hard, misclassified examples.
    Recommended for small EEG datasets where class confusion is common.

    gamma=0  →  equivalent to cross-entropy
    gamma=2  →  standard focal loss (recommended default)
    """

    def __init__(
        self,
        gamma: float = 2.0,
        label_smoothing: float = 0.0,
        ignore_index: int = 0,
    ) -> None:
        super().__init__()
        self.gamma = gamma
        self.label_smoothing = label_smoothing
        self.ignore_index = ignore_index

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        B, C = logits.shape
        mask = targets != self.ignore_index
        if mask.sum() == 0:
            return logits.sum() * 0.0

        logits_m = logits[mask]
        targets_m = targets[mask]
        log_p = F.log_softmax(logits_m, dim=-1)   # (N, C)

        if self.label_smoothing > 0.0:
            smooth = self.label_smoothing / max(C - 1, 1)
            one_hot = torch.full_like(log_p, smooth)
            one_hot.scatter_(1, targets_m.unsqueeze(1), 1.0 - self.label_smoothing)
            nll = -(one_hot * log_p).sum(dim=-1)   # (N,)
            # For focal weight, use the ground-truth class probability
            p_t = log_p.gather(1, targets_m.unsqueeze(1)).squeeze(1).exp()
        else:
            nll = F.nll_loss(log_p, targets_m, reduction='none')
            p_t = (-nll).exp()

        focal_w = (1.0 - p_t) ** self.gamma
        return (focal_w * nll).mean()


# ── EEG Augmentation ─────────────────────────────────────────────────────────

class EEGAugmentation:
    """
    Online per-batch augmentation for EEG. Each transform applied independently
    with probability p.

    Input: (B, Chans, Samples) tensor

    Transforms:
      channel_dropout     — zero random channels (models electrode impedance issues)
      gaussian_noise      — add scaled Gaussian noise (models baseline drift)
      amplitude_scaling   — multiply by random scalar (models amplitude variability)
      time_shift          — circular shift in time (data-efficient temporal jitter)
      freq_band_dropout   — zero a random freq band (theta/alpha/beta) via FFT
                            Models situation where a specific brain rhythm is absent.
                            Per 2024 EEG augmentation literature, this is the most
                            EEG-specific augmentation and improves generalisation.
    """

    def __init__(
        self,
        channel_dropout: bool = True,
        gaussian_noise: bool = True,
        amplitude_scaling: bool = True,
        time_shift: bool = True,
        freq_band_dropout: bool = True,
        p: float = 0.5,
    ) -> None:
        self.channel_dropout = channel_dropout
        self.gaussian_noise = gaussian_noise
        self.amplitude_scaling = amplitude_scaling
        self.time_shift = time_shift
        self.freq_band_dropout = freq_band_dropout
        self.p = p

    def __call__(self, x: torch.Tensor) -> torch.Tensor:
        if self.channel_dropout and torch.rand(1).item() < self.p:
            mask = (torch.rand(x.size(0), x.size(1), 1, device=x.device) > 0.1).float()
            x = x * mask

        if self.gaussian_noise and torch.rand(1).item() < self.p:
            rms = x.std(dim=-1, keepdim=True).clamp(min=1e-6)
            x = x + torch.randn_like(x) * 0.02 * rms

        if self.amplitude_scaling and torch.rand(1).item() < self.p:
            scale = torch.empty(x.size(0), 1, 1, device=x.device).uniform_(0.85, 1.15)
            x = x * scale

        if self.time_shift and torch.rand(1).item() < self.p:
            shift = int(x.size(-1) * 0.15 * (torch.rand(1).item() * 2 - 1))
            if shift != 0:
                x = torch.roll(x, shift, dims=-1)

        if self.freq_band_dropout and torch.rand(1).item() < self.p:
            # Zero a random frequency band (theta / alpha / beta) in the spectral domain
            xf = torch.fft.rfft(x, dim=-1)
            band = _FREQ_BANDS[torch.randint(len(_FREQ_BANDS), (1,)).item()]
            xf[..., band[0]:band[1]] = 0.0
            x = torch.fft.irfft(xf, n=x.size(-1), dim=-1)

        return x


# ── Dataset Classes ───────────────────────────────────────────────────────────

class RealEEGDataset(torch.utils.data.Dataset):
    """
    Loads word-windowed EEG from session CSV files with full preprocessing.

    Preprocessing per window (requires scipy):
      1. Common Average Reference (CAR)
      2. Bandpass 0.5–40 Hz (4th-order Butterworth, filtfilt)
      3. Notch 60 Hz (Q=30, filtfilt)
      4. Artifact rejection: skip windows where any value exceeds ±100 µV
    """

    def __init__(
        self,
        csv_paths: list,
        channels: int = 16,
        time_samples: int = 256,
        preprocess: bool = True,
    ) -> None:
        self.channels = channels
        self.time_samples = time_samples
        self.preprocess = preprocess
        self.samples: list = []
        for path in csv_paths:
            self._load_csv(path)

    def _preprocess_eeg(self, data: np.ndarray) -> Optional[np.ndarray]:
        """Returns preprocessed (channels, samples) array, or None if rejected."""
        try:
            from scipy.signal import butter, filtfilt, iirnotch
        except ImportError:
            return data

        data = data - data.mean(axis=0, keepdims=True)           # CAR

        b, a = butter(4, [0.5, 40.0], fs=125.0, btype="band")
        data = filtfilt(b, a, data, axis=1)                      # Bandpass

        b, a = iirnotch(60.0, 30.0, fs=125.0)
        data = filtfilt(b, a, data, axis=1)                      # Notch 60 Hz

        if np.abs(data).max() > 100.0:
            return None                                          # Artifact rejection

        return data

    def _load_csv(self, path: str) -> None:
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except (OSError, IOError):
            return

        header_end = 0
        for i, line in enumerate(lines):
            if line.strip() == "":
                header_end = i + 1
                break

        col_header_idx = None
        for i in range(header_end, len(lines)):
            if lines[i].strip().startswith("event,"):
                col_header_idx = i
                break
        if col_header_idx is None:
            return

        word_buffers: dict = {}

        for line in lines[col_header_idx + 1:]:
            parts = line.strip().split(",")
            if len(parts) < 6:
                continue
            event = parts[0].strip()

            if event == "word_start":
                word = parts[1].strip().upper()
                trial = parts[3].strip()
                word_buffers[(word, trial)] = []

            elif event == "eeg_sample":
                ch_vals = parts[6:]
                if len(ch_vals) < self.channels:
                    continue
                try:
                    row = [float(v) if v.strip() else 0.0 for v in ch_vals[:self.channels]]
                except ValueError:
                    continue
                for key in list(word_buffers.keys()):
                    word_buffers[key].append(row)

            elif event == "word_end":
                word = parts[1].strip().upper()
                trial = parts[3].strip()
                key = (word, trial)
                if key not in word_buffers:
                    continue

                rows = word_buffers.pop(key)
                if len(rows) < 5:
                    continue

                label_id = WORD_NAME_TO_ID.get(word)
                if label_id is None:
                    continue

                data = np.array(rows, dtype=np.float32).T
                if data.shape[0] != self.channels:
                    continue

                if self.preprocess:
                    data = self._preprocess_eeg(data)
                    if data is None:
                        continue

                if data.shape[1] != self.time_samples:
                    data_t = torch.from_numpy(data).unsqueeze(0)
                    data_t = F.interpolate(data_t, size=self.time_samples, mode="linear", align_corners=False)
                    data = data_t.squeeze(0).numpy()

                self.samples.append((
                    torch.tensor(data, dtype=torch.float32),
                    torch.tensor([label_id], dtype=torch.long),
                ))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        return self.samples[idx]


class SimulatedEEGDataset(torch.utils.data.Dataset):
    """
    Synthetic fallback dataset for initial model pre-training.

    Generates band-limited signals with class-specific oscillatory patterns
    that mimic the theta/alpha frequency structure of real EEG.

    Each class gets a distinct theta peak (4.0–7.6 Hz) and alpha shift (9.0–12.6 Hz),
    which is a simplified model of the spectral differences observed between imagined
    words in the 2023-2024 imagined speech literature.
    """

    def __init__(self, num_samples: int = 200, channels: int = 16, time_samples: int = 256) -> None:
        n_classes = len(WORD_NAME_TO_ID)
        self.data = []
        t = torch.linspace(0, time_samples / 125.0, time_samples)  # seconds at 125 Hz

        for i in range(num_samples):
            label = (i % n_classes) + 1                         # 1..10
            class_idx = label - 1

            # Class-specific oscillation frequencies
            theta_hz = 4.0 + class_idx * 0.4                   # 4.0-7.6 Hz
            alpha_hz = 9.0 + class_idx * 0.4                   # 9.0-12.6 Hz

            # Broadband EEG-like noise
            noise = torch.randn(channels, time_samples) * 0.3

            # Add class-specific sinusoidal components (different amplitudes per channel)
            for ch in range(channels):
                ch_weight = 0.5 + (ch % 4) * 0.25              # channel-specific amplitude
                noise[ch] += ch_weight * torch.sin(2 * torch.pi * theta_hz * t)
                noise[ch] += (ch_weight * 0.5) * torch.sin(2 * torch.pi * alpha_hz * t)

            self.data.append((noise, torch.tensor([label], dtype=torch.long)))

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, idx: int):
        return self.data[idx]


# ── Collate ───────────────────────────────────────────────────────────────────

def collate_fn(batch):
    eeg_list, label_list = zip(*batch)
    return torch.stack(eeg_list), torch.stack(label_list)


# ── Model Factory ─────────────────────────────────────────────────────────────

def build_model(vocab_size: int = VOCAB_SIZE) -> tuple:
    """Return (EEGConformerModel, AdamW optimizer)."""
    model = EEGConformerModel(vocab_size=vocab_size)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=0.01)
    return model, optimizer


# ── Checkpoint I/O ────────────────────────────────────────────────────────────

def load_checkpoint(
    model: EEGConformerModel,
    optimizer,
    path: str,
    scheduler=None,
) -> int:
    """Load a checkpoint. Returns next starting epoch (0 if not found)."""
    if not os.path.exists(path):
        return 0
    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
        state = ckpt.get("model_state_dict", {})
        head_key = "head.weight"
        if head_key in state and state[head_key].shape[0] != model.vocab_size:
            print("[model] Vocab size mismatch — reinitialising head")
            state = {k: v for k, v in state.items() if not k.startswith("head.")}
            model.load_state_dict(state, strict=False)
        else:
            model.load_state_dict(state, strict=False)

        try:
            optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        except Exception:
            pass

        if scheduler is not None and "scheduler_state_dict" in ckpt and ckpt["scheduler_state_dict"]:
            try:
                scheduler.load_state_dict(ckpt["scheduler_state_dict"])
            except Exception:
                pass

        return ckpt.get("epoch", 0) + 1
    except Exception as e:
        print(f"[model] Could not load checkpoint {path}: {e}")
        return 0


def save_checkpoint(
    model: EEGConformerModel,
    optimizer,
    epoch: int,
    path: str,
    scheduler=None,
    best_val_loss: float = float("inf"),
    config: Optional[dict] = None,
) -> None:
    torch.save(
        {
            "epoch": epoch,
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "scheduler_state_dict": scheduler.state_dict() if scheduler is not None else None,
            "best_val_loss": best_val_loss,
            "config": config or {},
            "vocab": VOCAB,
            "vocab_size": model.vocab_size,
        },
        path,
    )


def checkpoint_info(path: str) -> dict:
    if not os.path.exists(path):
        return {"exists": False}
    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
        return {
            "exists": True,
            "epoch": ckpt.get("epoch", 0),
            "vocab_size": ckpt.get("vocab_size", VOCAB_SIZE),
            "vocab": ckpt.get("vocab", VOCAB),
            "best_val_loss": ckpt.get("best_val_loss", None),
            "config": ckpt.get("config", {}),
        }
    except Exception:
        return {"exists": False}


# ── Inference ─────────────────────────────────────────────────────────────────

def predict_word(model: EEGConformerModel, eeg_tensor: torch.Tensor) -> tuple:
    """
    Infer the most likely word from a single EEG window.

    Args:
        eeg_tensor: (Chans, N) — any sample count, resampled to 256 internally
    Returns:
        (word_str, confidence_0_to_1)

    Decoding strategy:
        The model returns (B, vocab_size) logits (mean-pooled over time).
        We apply softmax and take argmax over the 10 word classes (indices 1-10).
        This is consistent with training, which uses CE on these same logits.

        Previous strategy (pick single "best" time step) was inconsistent
        with the mean-pool training objective and has been removed.
    """
    model.eval()
    with torch.no_grad():
        if eeg_tensor.shape[-1] != 256:
            eeg_tensor = F.interpolate(
                eeg_tensor.unsqueeze(0), size=256, mode="linear", align_corners=False
            ).squeeze(0)

        logits = model(eeg_tensor.unsqueeze(0))       # (1, vocab_size)
        probs = F.softmax(logits[0], dim=-1)          # (vocab_size,)

        # Exclude index 0 (padding token), argmax over word classes 1-10
        word_probs = probs[1:]                        # (10,)
        confidence, best_idx = word_probs.max(dim=0)
        word_id = best_idx.item() + 1                 # offset back for VOCAB indexing

        word_str = VOCAB[word_id] if word_id < len(VOCAB) else "<unknown>"
        return word_str, confidence.item()
