"""
EEG-to-Text Model
EEGNet-inspired feature extractor + BiLSTM classifier for BCI word classification.
Extracted from SimEEgN_LTSM_Train.ipynb for backend integration.
"""

from __future__ import annotations

import csv as csv_mod
import os
import random
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset

# ── Device ──────────────────────────────────────────────────────────────────────
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ── Vocabulary ──────────────────────────────────────────────────────────────────
VOCAB = [
    "<blank>",  # 0 – EOS / blank token
    "yes", "no", "help", "stop", "go",
    "water", "food", "pain", "more", "need",
]
VOCAB_SIZE = len(VOCAB)   # 11
EOS_TOKEN = 0

WORD_NAME_TO_ID: dict[str, int] = {
    "YES": 1, "NO": 2, "HELP": 3, "STOP": 4, "GO": 5,
    "WATER": 6, "FOOD": 7, "PAIN": 8, "MORE": 9, "NEED": 10,
}

# ── Checkpoint path ──────────────────────────────────────────────────────────────
CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "model_checkpoint.pth")


# ── Feature extractor ────────────────────────────────────────────────────────────
class EEGNetFeatureExtractor(nn.Module):
    def __init__(
        self,
        Chans: int = 16,
        Samples: int = 256,
        dropoutRate: float = 0.2,
        kernLength: int = 64,
        F1: int = 8,
        D: int = 2,
        F2: int = 16,
    ):
        super().__init__()
        self.firstconv = nn.Sequential(
            nn.Conv2d(1, F1, kernel_size=(1, kernLength),
                      padding=(0, kernLength // 2), bias=False),
            nn.BatchNorm2d(F1, affine=False),
        )
        self.depthwiseConv = nn.Sequential(
            nn.Conv2d(F1, F1 * D, kernel_size=(Chans, 1), groups=F1, bias=False),
            nn.BatchNorm2d(F1 * D, affine=False),
            nn.ELU(),
            nn.AvgPool2d(kernel_size=(1, 4)),
            nn.Dropout(dropoutRate),
        )
        self.separableConv = nn.Sequential(
            nn.Conv2d(F1 * D, F2, kernel_size=(1, 8),
                      padding=(0, 8 // 2), bias=False),
            nn.BatchNorm2d(F2, affine=False),
            nn.ELU(),
            nn.AvgPool2d(kernel_size=(1, 2)),
            nn.Dropout(dropoutRate),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.unsqueeze(1)          # (B, 1, Chans, Samples)
        x = self.firstconv(x)
        x = self.depthwiseConv(x)
        x = self.separableConv(x)   # (B, F2, 1, 32)
        x = x.squeeze(2)            # (B, F2, 32)
        x = x.permute(0, 2, 1)      # (B, 32, F2)
        return x


# ── Full model ───────────────────────────────────────────────────────────────────
class EEGToTextModel(nn.Module):
    def __init__(
        self,
        hidden_dim: int = 128,
        vocab_size: int = VOCAB_SIZE,
        num_layers: int = 2,
    ):
        super().__init__()
        self.feature_extractor = EEGNetFeatureExtractor(Chans=16, Samples=256)
        self.lstm = nn.LSTM(
            input_size=16,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
        )
        self.classifier = nn.Linear(hidden_dim * 2, vocab_size)

    def forward(self, eeg_input: torch.Tensor) -> torch.Tensor:
        features = self.feature_extractor(eeg_input)    # (B, 32, 16)
        lstm_out, _ = self.lstm(features)               # (B, 32, hidden*2)
        return self.classifier(lstm_out)                # (B, 32, vocab_size)


# ── Decoder ──────────────────────────────────────────────────────────────────────
def epsilon_greedy_decode(
    logits: torch.Tensor,
    epsilon: float = 0.0,
    max_len: int = 1,
    repetition_limit: int = 2,
) -> list[int]:
    probs = torch.softmax(logits, dim=-1)
    decoded: list[int] = []
    last_token: Optional[int] = None
    repeat_count = 0
    for t in range(probs.size(1)):
        if random.random() < epsilon:
            token = random.randint(1, VOCAB_SIZE - 1)
        else:
            token = int(torch.argmax(probs[0, t]).item())
        if token == EOS_TOKEN:
            break
        if token == last_token:
            repeat_count += 1
            if repeat_count >= repetition_limit:
                break
        else:
            repeat_count = 1
        decoded.append(token)
        last_token = token
        if len(decoded) >= max_len:
            break
    return decoded


# ── Real EEG Dataset ─────────────────────────────────────────────────────────────
class RealEEGDataset(Dataset):
    """Loads word-windowed EEG data from session CSV files produced by the app."""

    def __init__(self, csv_paths: list[str], channels: int = 16, time_samples: int = 256):
        self.channels = channels
        self.time_samples = time_samples
        self.data: list[torch.Tensor] = []
        self.labels: list[torch.Tensor] = []
        for path in csv_paths:
            self._load_csv(path)
        print(f"RealEEGDataset: {len(self.data)} word windows from {len(csv_paths)} file(s)")

    def _load_csv(self, csv_path: str) -> None:
        ch_cols = [f"ch{i}" for i in range(1, self.channels + 1)]

        # Find the data header row
        header_line = 0
        with open(csv_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if line.startswith("event,"):
                    header_line = i
                    break

        rows: list[dict] = []
        with open(csv_path, "r", encoding="utf-8") as f:
            for _ in range(header_line):
                next(f)
            for row in csv_mod.DictReader(f):
                rows.append(row)

        if not rows:
            return

        word_starts = [r for r in rows if r.get("event") == "word_start"]
        word_ends   = [r for r in rows if r.get("event") == "word_end"]
        eeg_rows    = [r for r in rows if r.get("event") == "eeg_sample"]

        for ws in word_starts:
            word_name = ws.get("word", "").strip().upper()
            trial     = ws.get("trial", "")
            t_start   = float(ws.get("relative_time_ms", 0))

            matching = [
                we for we in word_ends
                if we.get("word", "").strip().upper() == word_name
                and we.get("trial", "") == trial
            ]
            if not matching:
                continue
            t_end = float(matching[0].get("relative_time_ms", 0))

            window = [
                r for r in eeg_rows
                if t_start <= float(r.get("relative_time_ms", 0)) <= t_end
            ]
            if len(window) < 5:
                continue

            try:
                arr = np.array(
                    [[float(r.get(ch, 0) or 0) for ch in ch_cols] for r in window],
                    dtype=np.float32,
                ).T  # (16, n_samples)
            except ValueError:
                continue

            t = torch.tensor(arr).unsqueeze(0)  # (1, 16, n)
            if t.shape[2] != self.time_samples:
                t = F.interpolate(t, size=self.time_samples, mode="linear", align_corners=False)
            eeg_tensor = t.squeeze(0).to(device)  # (16, 256)

            if word_name not in WORD_NAME_TO_ID:
                continue
            self.data.append(eeg_tensor)
            self.labels.append(torch.tensor([WORD_NAME_TO_ID[word_name]], dtype=torch.long).to(device))

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, idx: int):
        return self.data[idx], self.labels[idx]


# ── Simulated Dataset (pre-training fallback) ────────────────────────────────────
class SimulatedEEGDataset(Dataset):
    """Synthetic EEG data for pre-training when no real recordings exist yet."""

    def __init__(self, num_samples: int = 200):
        self.channels = 16
        self.time_samples = 256
        self.data: list[torch.Tensor] = []
        self.labels: list[torch.Tensor] = []

        np.random.seed(42)
        token_patterns: dict[int, torch.Tensor] = {}
        for token in range(1, VOCAB_SIZE):
            token_patterns[token] = torch.tensor(
                np.random.randn(self.channels, self.time_samples // 4), dtype=torch.float
            )

        for _ in range(num_samples):
            label = [random.randint(1, VOCAB_SIZE - 1)]
            self.labels.append(torch.tensor(label, dtype=torch.long).to(device))
            eeg = torch.randn(self.channels, self.time_samples, device=device) * 0.1
            pat = token_patterns[label[0]]
            if pat.shape[1] != self.time_samples:
                pat = F.interpolate(
                    pat.unsqueeze(0), size=self.time_samples,
                    mode="linear", align_corners=False,
                ).squeeze(0)
            eeg += pat.to(device)
            self.data.append(eeg)

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, idx: int):
        return self.data[idx], self.labels[idx]


# ── Collate ──────────────────────────────────────────────────────────────────────
def collate_fn(batch):
    eegs, labels = zip(*batch)
    return torch.stack(eegs), labels


# ── Checkpoint helpers ────────────────────────────────────────────────────────────
def build_model() -> tuple[EEGToTextModel, torch.optim.Adam]:
    model = EEGToTextModel(hidden_dim=128, vocab_size=VOCAB_SIZE, num_layers=2).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    return model, optimizer


def load_checkpoint(
    model: EEGToTextModel,
    optimizer: torch.optim.Adam,
    path: str = CHECKPOINT_PATH,
) -> int:
    """Load checkpoint if it exists. Returns the next starting epoch."""
    if not os.path.exists(path):
        return 0
    ckpt = torch.load(path, map_location=device, weights_only=True)
    state = ckpt["model_state_dict"]
    if state["classifier.weight"].shape[0] != model.classifier.weight.shape[0]:
        state.pop("classifier.weight", None)
        state.pop("classifier.bias", None)
        model.load_state_dict(state, strict=False)
    else:
        model.load_state_dict(state)
        optimizer.load_state_dict(ckpt["optimizer_state_dict"])
    return ckpt.get("epoch", 0) + 1


def save_checkpoint(
    model: EEGToTextModel,
    optimizer: torch.optim.Adam,
    epoch: int,
    path: str = CHECKPOINT_PATH,
) -> None:
    torch.save(
        {
            "epoch": epoch,
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "vocab": VOCAB,
            "vocab_size": VOCAB_SIZE,
        },
        path,
    )


def checkpoint_info(path: str = CHECKPOINT_PATH) -> dict:
    if not os.path.exists(path):
        return {"exists": False}
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    return {
        "exists": True,
        "epoch": ckpt.get("epoch", 0),
        "vocab_size": ckpt.get("vocab_size", VOCAB_SIZE),
        "vocab": ckpt.get("vocab", VOCAB),
    }


# ── Inference ─────────────────────────────────────────────────────────────────────
def predict_word(model: EEGToTextModel, eeg_tensor: torch.Tensor) -> tuple[str, float]:
    """
    Run inference on a single EEG segment.

    Args:
        model: trained EEGToTextModel
        eeg_tensor: (16, N) float tensor in microvolts

    Returns:
        (predicted_word, confidence_0_to_1)
    """
    model.eval()
    with torch.no_grad():
        if eeg_tensor.shape[1] != 256:
            eeg_tensor = F.interpolate(
                eeg_tensor.unsqueeze(0), size=256,
                mode="linear", align_corners=False,
            ).squeeze(0)
        logits = model(eeg_tensor.unsqueeze(0).to(device))   # (1, 32, vocab_size)
        probs = torch.softmax(logits, dim=-1)                 # (1, 32, vocab_size)

        # Find the non-blank token with the highest probability across all time steps
        max_probs, max_tokens = probs[0].max(dim=-1)          # (32,)
        non_blank = [
            (float(max_probs[t].item()), int(max_tokens[t].item()))
            for t in range(probs.size(1))
            if int(max_tokens[t].item()) != EOS_TOKEN
        ]
        if not non_blank:
            return "<blank>", 0.0
        conf, token = max(non_blank, key=lambda x: x[0])
        return VOCAB[token], round(conf, 4)
