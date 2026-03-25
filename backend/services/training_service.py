"""
Training Service
Manages EEG-to-text model training lifecycle, session listing, and inference.

Features:
  - TrainingConfig dataclass (lr, batch_size, warmup, grad_clip, early stop, augmentation)
  - AdamW optimizer + OneCycleLR scheduler (warmup built-in)
  - FocalLoss (gamma=2) or label-smoothed CrossEntropy — CTC removed (wrong for single-word)
  - Online EEG augmentation (channel dropout, noise, amplitude scaling, time shift, freq-band dropout)
  - 80/20 validation split with early stopping
  - Per-word accuracy tracking
  - Multi-checkpoint strategy: best / latest / every-N-epochs
"""
from __future__ import annotations

import csv as csv_mod
import threading
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, random_split

from constants import DATA_DIR
from model import (
    BEST_CHECKPOINT_PATH,
    CHECKPOINT_DIR,
    CHECKPOINT_PATH,
    LATEST_CHECKPOINT_PATH,
    EOS_TOKEN,
    VOCAB,
    VOCAB_SIZE,
    WORD_NAME_TO_ID,
    EEGAugmentation,
    FocalLoss,
    RealEEGDataset,
    SimulatedEEGDataset,
    build_model,
    checkpoint_info,
    collate_fn,
    load_checkpoint,
    predict_word,
    save_checkpoint,
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ── Training Configuration ────────────────────────────────────────────────────

@dataclass
class TrainingConfig:
    lr: float = 2e-4
    batch_size: int = 8
    warmup_epochs: int = 5          # OneCycleLR uses pct_start = warmup/total
    grad_clip: float = 1.0
    early_stop_patience: int = 25
    val_fraction: float = 0.2
    checkpoint_every_n: int = 5
    aug_channel_dropout: bool = True
    aug_gaussian_noise: bool = True
    aug_amplitude_scaling: bool = True
    aug_time_shift: bool = True
    aug_freq_band_dropout: bool = True   # Zero random theta/alpha/beta band via FFT
    use_focal_loss: bool = False         # False → label-smoothed CE; True → FocalLoss
    focal_gamma: float = 2.0
    label_smoothing: float = 0.1        # Applied regardless of use_focal_loss

    def to_dict(self) -> dict:
        return asdict(self)


class TrainingStatus:
    IDLE = "idle"
    TRAINING = "training"
    COMPLETE = "complete"
    ERROR = "error"


# ── Service ───────────────────────────────────────────────────────────────────

class TrainingService:
    """
    Full training lifecycle manager.

    Public API:
      list_sessions()            → list[dict]
      get_session_events(id)     → list[dict] | None
      start_training(ids, epochs, config) → bool
      stop_training()
      get_status_dict()          → dict
      list_checkpoints()         → list[dict]
      load_checkpoint_by_name(name) → bool
      predict_session(id)        → list[dict] | None
    """

    def __init__(self, data_dir: str = DATA_DIR) -> None:
        self.data_dir = Path(data_dir)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # Training state (always access under _lock)
        self._status: str = TrainingStatus.IDLE
        self._current_epoch: int = 0
        self._total_epochs: int = 0
        self._loss: float = 0.0
        self._val_loss: float = 0.0
        self._best_val_loss: float = float("inf")
        self._best_epoch: int = 0
        self._accuracy: float = 0.0
        self._lr: float = 0.0
        self._error: Optional[str] = None
        self._log: list[dict] = []
        self._per_word_accuracy: dict[str, float] = {}

        # Model (persistent — survives across training runs)
        self.model, self.optimizer = build_model()
        start_epoch = load_checkpoint(self.model, self.optimizer, BEST_CHECKPOINT_PATH)
        if start_epoch == 0:
            start_epoch = load_checkpoint(self.model, self.optimizer, LATEST_CHECKPOINT_PATH)
        if start_epoch == 0:
            start_epoch = load_checkpoint(self.model, self.optimizer, CHECKPOINT_PATH)
        self.model.to(DEVICE)
        print(f"[TrainingService] ready — resume epoch={start_epoch}, device={DEVICE}")

    # ── Session listing ───────────────────────────────────────────────────────

    def list_sessions(self) -> list[dict]:
        sessions = []
        for csv_path in sorted(self.data_dir.glob("session_*.csv")):
            meta = self._parse_metadata(csv_path)
            if meta:
                sessions.append(meta)
        return sessions

    def _parse_metadata(self, csv_path: Path) -> Optional[dict[str, Any]]:
        meta: dict[str, Any] = {"session_id": "", "filename": csv_path.name, "eeg_sample_count": 0}
        key_map = {
            "session_id": "session_id",
            "participant_name": "participant_name",
            "participant_age": "participant_age",
            "total_trials": "total_trials",
            "start_time": "start_time",
            "end_time": "end_time",
            "eeg_enabled": "eeg_enabled",
        }
        eeg_count = 0
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                in_header = True
                for line in f:
                    stripped = line.strip()
                    if in_header:
                        if not stripped or stripped.startswith("event,"):
                            in_header = False
                            continue
                        parts = stripped.split(",", 1)
                        if len(parts) == 2:
                            k, v = parts[0].strip(), parts[1].strip()
                            if k in key_map:
                                meta[key_map[k]] = v
                    else:
                        if stripped.startswith("eeg_sample,"):
                            eeg_count += 1
        except OSError:
            return None
        meta["eeg_sample_count"] = eeg_count
        return meta

    # ── Playback events ───────────────────────────────────────────────────────

    def get_session_events(self, session_id: str) -> Optional[list[dict]]:
        csv_path = self._find_csv(session_id)
        if not csv_path:
            return None
        header_line = self._find_header_line(csv_path)
        events = []
        with open(csv_path, "r", encoding="utf-8") as f:
            for _ in range(header_line):
                next(f)
            for row in csv_mod.DictReader(f):
                if row.get("event") != "eeg_sample":
                    events.append({
                        "event": row.get("event", ""),
                        "word": row.get("word", ""),
                        "word_id": row.get("word_id", ""),
                        "trial": row.get("trial", ""),
                        "timestamp": row.get("timestamp", ""),
                        "relative_time_ms": row.get("relative_time_ms", ""),
                    })
        return events

    # ── Training ──────────────────────────────────────────────────────────────

    def start_training(
        self,
        session_ids: list[str],
        epochs: int,
        config: Optional[TrainingConfig] = None,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> bool:
        with self._lock:
            if self._status == TrainingStatus.TRAINING:
                return False
            self._status = TrainingStatus.TRAINING
            self._total_epochs = epochs
            self._current_epoch = 0
            self._loss = 0.0
            self._val_loss = 0.0
            self._accuracy = 0.0
            self._error = None
            self._log = []
            self._per_word_accuracy = {}

        cfg = config or TrainingConfig()
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._training_loop,
            args=(session_ids, epochs, cfg, on_progress),
            daemon=True,
            name="TrainingThread",
        )
        self._thread.start()
        return True

    def stop_training(self) -> None:
        self._stop_event.set()

    def _training_loop(
        self,
        session_ids: list[str],
        total_epochs: int,
        cfg: TrainingConfig,
        on_progress: Optional[Callable[[dict], None]],
    ) -> None:
        try:
            # ── Build dataset ────────────────────────────────────────────────
            csv_paths = [
                str(p) for sid in session_ids
                if (p := self._find_csv(sid)) is not None
            ]
            dataset: Any
            if csv_paths:
                dataset = RealEEGDataset(csv_paths)
            if not csv_paths or len(dataset) == 0:
                print("[Training] No real EEG data; using simulated dataset.")
                dataset = SimulatedEEGDataset(num_samples=200)

            # ── Validation split ─────────────────────────────────────────────
            n_total = len(dataset)
            n_val = max(1, int(n_total * cfg.val_fraction))
            n_train = n_total - n_val
            if n_train < 1:
                n_train, n_val = n_total, 0
            if n_val > 0:
                train_ds, val_ds = random_split(dataset, [n_train, n_val])
            else:
                train_ds, val_ds = dataset, None

            train_loader = DataLoader(
                train_ds,
                batch_size=max(1, cfg.batch_size),
                shuffle=True,
                collate_fn=collate_fn,
                drop_last=False,
            )
            val_loader = DataLoader(
                val_ds,
                batch_size=max(1, cfg.batch_size),
                shuffle=False,
                collate_fn=collate_fn,
            ) if val_ds and n_val > 0 else None

            # ── Reinitialise optimizer with config LR ────────────────────────
            self.optimizer = torch.optim.AdamW(
                self.model.parameters(), lr=cfg.lr, weight_decay=0.01
            )

            total_steps = len(train_loader) * total_epochs
            pct_start = min(cfg.warmup_epochs / max(total_epochs, 1), 0.3)
            scheduler = torch.optim.lr_scheduler.OneCycleLR(
                self.optimizer,
                max_lr=cfg.lr,
                total_steps=max(total_steps, 1),
                pct_start=pct_start,
                anneal_strategy="cos",
            )

            # ── Augmentation ─────────────────────────────────────────────────
            augment = EEGAugmentation(
                channel_dropout=cfg.aug_channel_dropout,
                gaussian_noise=cfg.aug_gaussian_noise,
                amplitude_scaling=cfg.aug_amplitude_scaling,
                time_shift=cfg.aug_time_shift,
                freq_band_dropout=cfg.aug_freq_band_dropout,
            )

            # ── Loss function ─────────────────────────────────────────────────
            if cfg.use_focal_loss:
                criterion = FocalLoss(
                    gamma=cfg.focal_gamma,
                    label_smoothing=cfg.label_smoothing,
                    ignore_index=EOS_TOKEN,
                )
            else:
                criterion = FocalLoss(
                    gamma=0.0,
                    label_smoothing=cfg.label_smoothing,
                    ignore_index=EOS_TOKEN,
                )

            best_val_loss = self._best_val_loss
            epochs_no_improve = 0
            ckpt_info = checkpoint_info(LATEST_CHECKPOINT_PATH)
            start_epoch = ckpt_info.get("epoch", -1) + 1 if ckpt_info.get("exists") else 0

            for epoch_offset in range(total_epochs):
                if self._stop_event.is_set():
                    break

                global_epoch = start_epoch + epoch_offset
                self.model.train()

                total_loss = 0.0
                total_samples = 0
                word_correct: dict[str, int] = {}
                word_total: dict[str, int] = {}

                for eegs, label_seqs in train_loader:
                    if self._stop_event.is_set():
                        break

                    eegs = eegs.to(DEVICE)
                    labels = label_seqs.squeeze(1).to(DEVICE)    # (B,)
                    B = eegs.size(0)

                    # Augmentation
                    eegs = augment(eegs)

                    self.optimizer.zero_grad()
                    logits = self.model(eegs)                     # (B, vocab_size)

                    loss = criterion(logits, labels)
                    loss.backward()

                    if cfg.grad_clip > 0:
                        nn.utils.clip_grad_norm_(self.model.parameters(), cfg.grad_clip)

                    self.optimizer.step()
                    scheduler.step()

                    total_loss += loss.item() * B
                    total_samples += B

                    # Per-word accuracy
                    preds = logits.argmax(dim=-1)                 # (B,)
                    for pred, true_lbl in zip(preds.cpu().tolist(), labels.cpu().tolist()):
                        if true_lbl == EOS_TOKEN:
                            continue
                        word = VOCAB[true_lbl] if true_lbl < len(VOCAB) else f"id{true_lbl}"
                        word_total[word] = word_total.get(word, 0) + 1
                        if pred == true_lbl:
                            word_correct[word] = word_correct.get(word, 0) + 1

                avg_train_loss = total_loss / max(total_samples, 1)
                overall_acc = (
                    sum(word_correct.values()) / max(sum(word_total.values()), 1) * 100.0
                )
                per_word_acc = {
                    w: round(word_correct.get(w, 0) / max(word_total[w], 1) * 100.0, 1)
                    for w in word_total
                }

                # ── Validation loop ──────────────────────────────────────────
                avg_val_loss = avg_train_loss  # fallback when no val set
                if val_loader is not None:
                    self.model.eval()
                    val_loss_sum = 0.0
                    val_samples = 0
                    with torch.no_grad():
                        for eegs_v, lbl_v in val_loader:
                            eegs_v = eegs_v.to(DEVICE)
                            labels_v = lbl_v.squeeze(1).to(DEVICE)
                            Bv = eegs_v.size(0)
                            logits_v = self.model(eegs_v)         # (Bv, vocab_size)
                            val_loss_sum += criterion(logits_v, labels_v).item() * Bv
                            val_samples += Bv
                    avg_val_loss = val_loss_sum / max(val_samples, 1)
                    self.model.train()

                current_lr = scheduler.get_last_lr()[0] if hasattr(scheduler, "get_last_lr") else cfg.lr

                epoch_log = {
                    "epoch": epoch_offset + 1,
                    "loss": round(avg_train_loss, 4),
                    "val_loss": round(avg_val_loss, 4),
                    "accuracy": round(overall_acc, 2),
                    "lr": round(current_lr, 7),
                }

                with self._lock:
                    self._current_epoch = epoch_offset + 1
                    self._loss = avg_train_loss
                    self._val_loss = avg_val_loss
                    self._accuracy = overall_acc
                    self._lr = current_lr
                    self._per_word_accuracy = per_word_acc
                    self._log.append(epoch_log)

                # ── Checkpoint saving ─────────────────────────────────────────
                if avg_val_loss < best_val_loss:
                    best_val_loss = avg_val_loss
                    epochs_no_improve = 0
                    with self._lock:
                        self._best_val_loss = best_val_loss
                        self._best_epoch = epoch_offset + 1
                    save_checkpoint(self.model, self.optimizer, global_epoch, BEST_CHECKPOINT_PATH,
                                    scheduler=scheduler, best_val_loss=best_val_loss, config=cfg.to_dict())
                else:
                    epochs_no_improve += 1

                save_checkpoint(self.model, self.optimizer, global_epoch, LATEST_CHECKPOINT_PATH,
                                scheduler=scheduler, best_val_loss=best_val_loss, config=cfg.to_dict())

                if (epoch_offset + 1) % cfg.checkpoint_every_n == 0:
                    periodic_path = Path(CHECKPOINT_DIR) / f"model_epoch_{global_epoch}.pth"
                    save_checkpoint(self.model, self.optimizer, global_epoch, str(periodic_path),
                                    scheduler=scheduler, best_val_loss=best_val_loss, config=cfg.to_dict())

                print(
                    f"[Training] Epoch {epoch_offset + 1}/{total_epochs} "
                    f"| train={avg_train_loss:.4f} | val={avg_val_loss:.4f} "
                    f"| acc={overall_acc:.1f}% | lr={current_lr:.6f}"
                )

                if on_progress:
                    on_progress(self.get_status_dict())

                # ── Early stopping ────────────────────────────────────────────
                if cfg.early_stop_patience > 0 and epochs_no_improve >= cfg.early_stop_patience:
                    print(f"[Training] Early stopping at epoch {epoch_offset + 1} (patience={cfg.early_stop_patience})")
                    break

        except Exception as e:
            import traceback
            print(f"[Training] Error: {e}\n{traceback.format_exc()}")
            with self._lock:
                self._status = TrainingStatus.ERROR
                self._error = str(e)
            return

        with self._lock:
            self._status = (
                TrainingStatus.COMPLETE if not self._stop_event.is_set()
                else TrainingStatus.IDLE
            )

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status_dict(self) -> dict:
        with self._lock:
            return {
                "status": self._status,
                "current_epoch": self._current_epoch,
                "total_epochs": self._total_epochs,
                "loss": round(self._loss, 4),
                "val_loss": round(self._val_loss, 4),
                "best_val_loss": round(self._best_val_loss, 4) if self._best_val_loss != float("inf") else None,
                "best_epoch": self._best_epoch,
                "accuracy": round(self._accuracy, 2),
                "lr": self._lr,
                "error": self._error,
                "log": list(self._log),
                "per_word_accuracy": dict(self._per_word_accuracy),
                "checkpoint": checkpoint_info(BEST_CHECKPOINT_PATH),
                "available_checkpoints": self.list_checkpoints(),
            }

    # ── Checkpoint management ─────────────────────────────────────────────────

    def list_checkpoints(self) -> list[dict]:
        """Return metadata for all *.pth files in the backend directory."""
        ckpts = []
        for pth in sorted(Path(CHECKPOINT_DIR).glob("*.pth")):
            info = checkpoint_info(str(pth))
            if info.get("exists"):
                ckpts.append({
                    "name": pth.name,
                    "epoch": info.get("epoch", 0),
                    "val_loss": info.get("best_val_loss"),
                    "is_best": pth.name == Path(BEST_CHECKPOINT_PATH).name,
                })
        return ckpts

    def load_checkpoint_by_name(self, name: str) -> bool:
        """
        Load a checkpoint by filename (must be in the backend directory).
        Returns True on success.
        """
        # Prevent path traversal
        safe_name = Path(name).name
        path = Path(CHECKPOINT_DIR) / safe_name
        if not path.exists() or path.suffix != ".pth":
            return False
        try:
            load_checkpoint(self.model, self.optimizer, str(path))
            return True
        except Exception as e:
            print(f"[TrainingService] load_checkpoint_by_name error: {e}")
            return False

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict_session(self, session_id: str) -> Optional[list[dict]]:
        best_info = checkpoint_info(BEST_CHECKPOINT_PATH)
        latest_info = checkpoint_info(LATEST_CHECKPOINT_PATH)
        if not best_info.get("exists") and not latest_info.get("exists"):
            return None

        csv_path = self._find_csv(session_id)
        if not csv_path:
            return None

        header_line = self._find_header_line(csv_path)
        rows: list[dict] = []
        with open(csv_path, "r", encoding="utf-8") as f:
            for _ in range(header_line):
                next(f)
            for row in csv_mod.DictReader(f):
                rows.append(row)

        ch_cols = [f"ch{i}" for i in range(1, 17)]
        word_starts = [r for r in rows if r.get("event") == "word_start"]
        word_ends   = [r for r in rows if r.get("event") == "word_end"]
        eeg_rows    = [r for r in rows if r.get("event") == "eeg_sample"]

        results = []
        for ws in word_starts:
            word_name = ws.get("word", "").strip().upper()
            trial     = ws.get("trial", "")
            t_start   = float(ws.get("relative_time_ms", 0))

            matching = [
                we for we in word_ends
                if we.get("word", "").strip().upper() == word_name
                and we.get("trial", "") == trial
            ]
            t_end = float(matching[0].get("relative_time_ms", 0)) if matching else t_start + 5000

            window = [
                r for r in eeg_rows
                if t_start <= float(r.get("relative_time_ms", 0)) <= t_end
            ]

            has_eeg = len(window) >= 5
            if has_eeg:
                try:
                    arr = np.array(
                        [[float(r.get(ch, 0) or 0) for ch in ch_cols] for r in window],
                        dtype=np.float32,
                    ).T  # (16, n_samples)
                    t = torch.tensor(arr)
                    t = F.interpolate(t.unsqueeze(0), size=256, mode="linear", align_corners=False).squeeze(0)
                    predicted, confidence = predict_word(self.model, t)
                except Exception:
                    predicted, confidence = "<error>", 0.0
            else:
                predicted, confidence = "<no EEG>", 0.0

            results.append({
                "trial": trial,
                "word": word_name,
                "word_id": ws.get("word_id", ""),
                "relative_time_ms": t_start,
                "predicted": predicted,
                "confidence": round(confidence, 3),
                "has_eeg": has_eeg,
            })

        return results

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _find_csv(self, session_id: str) -> Optional[Path]:
        matches = list(self.data_dir.glob(f"session_{session_id}_*.csv"))
        return matches[0] if matches else None

    def _find_header_line(self, csv_path: Path) -> int:
        with open(csv_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if line.startswith("event,"):
                    return i
        return 0
