"""
Training Service
Manages EEG-to-text model training lifecycle, session listing, and inference.
"""

from __future__ import annotations

import csv as csv_mod
import threading
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

from constants import DATA_DIR
from model import (
    CHECKPOINT_PATH,
    EOS_TOKEN,
    VOCAB,
    VOCAB_SIZE,
    WORD_NAME_TO_ID,
    RealEEGDataset,
    SimulatedEEGDataset,
    build_model,
    checkpoint_info,
    collate_fn,
    device,
    epsilon_greedy_decode,
    load_checkpoint,
    predict_word,
    save_checkpoint,
)


class TrainingStatus:
    IDLE = "idle"
    TRAINING = "training"
    COMPLETE = "complete"
    ERROR = "error"


class TrainingService:
    """
    Manages the full training lifecycle:
    - list_sessions(): scan data dir for saved CSV files
    - get_session_events(): parse event timeline for playback
    - start_training(): run training in a background thread
    - stop_training(): signal background thread to stop
    - get_status_dict(): current training progress (thread-safe)
    - predict_session(): run model inference on a saved session
    """

    def __init__(self, data_dir: str = DATA_DIR):
        self.data_dir = Path(data_dir)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # Training state (always access under _lock)
        self._status: str = TrainingStatus.IDLE
        self._current_epoch: int = 0
        self._total_epochs: int = 0
        self._loss: float = 0.0
        self._accuracy: float = 0.0
        self._error: Optional[str] = None
        self._log: list[dict] = []

        # Model (persistent — survives across training runs)
        self.model, self.optimizer = build_model()
        start_epoch = load_checkpoint(self.model, self.optimizer, CHECKPOINT_PATH)
        print(f"TrainingService: model ready (resume epoch={start_epoch}), device={device}")

    # ── Session listing ──────────────────────────────────────────────────────────

    def list_sessions(self) -> list[dict]:
        """Return metadata dicts for all session CSV files in the data directory."""
        sessions = []
        for csv_path in sorted(self.data_dir.glob("session_*.csv")):
            meta = self._parse_metadata(csv_path)
            if meta:
                sessions.append(meta)
        return sessions

    def _parse_metadata(self, csv_path: Path) -> Optional[dict[str, Any]]:
        """Read only the metadata header lines from a session CSV (fast)."""
        meta: dict[str, Any] = {
            "session_id": "",
            "filename": csv_path.name,
        }
        key_map = {
            "session_id": "session_id",
            "participant_name": "participant_name",
            "participant_age": "participant_age",
            "total_trials": "total_trials",
            "start_time": "start_time",
            "end_time": "end_time",
            "eeg_enabled": "eeg_enabled",
        }
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if not stripped or stripped.startswith("event,"):
                        break
                    parts = stripped.split(",", 1)
                    if len(parts) == 2:
                        k, v = parts[0].strip(), parts[1].strip()
                        if k in key_map:
                            meta[key_map[k]] = v
        except OSError:
            return None
        return meta

    # ── Playback events ──────────────────────────────────────────────────────────

    def get_session_events(self, session_id: str) -> Optional[list[dict]]:
        """Return all non-EEG event rows for playback timeline."""
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

    # ── Training ─────────────────────────────────────────────────────────────────

    def start_training(
        self,
        session_ids: list[str],
        epochs: int,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> bool:
        """
        Start training in a background thread.
        Returns False if training is already running.
        """
        with self._lock:
            if self._status == TrainingStatus.TRAINING:
                return False
            self._status = TrainingStatus.TRAINING
            self._total_epochs = epochs
            self._current_epoch = 0
            self._error = None
            self._log = []

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._training_loop,
            args=(session_ids, epochs, on_progress),
            daemon=True,
            name="TrainingThread",
        )
        self._thread.start()
        return True

    def stop_training(self) -> None:
        """Signal the background thread to stop after the current epoch."""
        self._stop_event.set()

    def _training_loop(
        self,
        session_ids: list[str],
        total_epochs: int,
        on_progress: Optional[Callable[[dict], None]],
    ) -> None:
        try:
            # Build dataset from selected sessions, fall back to simulated data
            csv_paths = [
                str(p) for sid in session_ids
                if (p := self._find_csv(sid)) is not None
            ]
            dataset: RealEEGDataset | SimulatedEEGDataset
            if csv_paths:
                dataset = RealEEGDataset(csv_paths)

            if not csv_paths or len(dataset) == 0:
                print("[Training] No real EEG data found; using simulated dataset.")
                dataset = SimulatedEEGDataset(num_samples=200)

            dataloader = DataLoader(dataset, batch_size=8, shuffle=True, collate_fn=collate_fn)
            ce_loss = nn.CrossEntropyLoss(ignore_index=EOS_TOKEN)
            n_samples = len(dataset)

            # Determine starting epoch from existing checkpoint
            start_epoch = checkpoint_info(CHECKPOINT_PATH).get("epoch", -1) + 1

            for epoch_offset in range(total_epochs):
                if self._stop_event.is_set():
                    break

                global_epoch = start_epoch + epoch_offset
                self.model.train()
                total_loss = 0.0
                total_tokens = 0
                correct = 0

                for eegs, label_seqs in dataloader:
                    if self._stop_event.is_set():
                        break

                    eegs = eegs.to(device)
                    self.optimizer.zero_grad()
                    logits = self.model(eegs)  # (B, 32, vocab_size)

                    # Build padded target tensor
                    targets_list = []
                    for seq in label_seqs:
                        seq_list = seq.tolist()
                        padded = seq_list + [EOS_TOKEN] * (32 - len(seq_list))
                        targets_list.append(padded)
                    targets = torch.tensor(targets_list, dtype=torch.long, device=device)

                    loss = ce_loss(logits.view(-1, VOCAB_SIZE), targets.view(-1))
                    loss.backward()
                    self.optimizer.step()

                    total_loss += loss.item() * logits.size(0) * logits.size(1)
                    total_tokens += logits.size(0) * logits.size(1)

                    # Online correction for misclassified samples
                    for i, true_seq in enumerate(label_seqs):
                        true_list = true_seq.tolist()
                        decoded = epsilon_greedy_decode(
                            logits[i: i + 1].detach(), max_len=len(true_list)
                        )
                        if decoded == true_list:
                            correct += 1
                        else:
                            self.optimizer.zero_grad()
                            sl = self.model(eegs[i: i + 1])
                            st = torch.tensor(
                                [true_list + [EOS_TOKEN] * (32 - len(true_list))],
                                dtype=torch.long, device=device,
                            )
                            sl_loss = ce_loss(sl.view(-1, VOCAB_SIZE), st.view(-1))
                            orig_lr = self.optimizer.param_groups[0]["lr"]
                            for g in self.optimizer.param_groups:
                                g["lr"] = 1e-4
                            sl_loss.backward()
                            self.optimizer.step()
                            for g in self.optimizer.param_groups:
                                g["lr"] = orig_lr

                avg_loss = total_loss / max(total_tokens, 1)
                acc = correct / max(n_samples, 1) * 100.0
                epoch_log = {
                    "epoch": epoch_offset + 1,
                    "loss": round(avg_loss, 4),
                    "accuracy": round(acc, 2),
                }

                with self._lock:
                    self._current_epoch = epoch_offset + 1
                    self._loss = avg_loss
                    self._accuracy = acc
                    self._log.append(epoch_log)

                save_checkpoint(self.model, self.optimizer, global_epoch, CHECKPOINT_PATH)
                print(
                    f"[Training] Epoch {epoch_offset + 1}/{total_epochs} "
                    f"| Loss={avg_loss:.4f} | Acc={acc:.1f}%"
                )

                if on_progress:
                    on_progress(self.get_status_dict())

        except Exception as e:
            print(f"[Training] Error: {e}")
            with self._lock:
                self._status = TrainingStatus.ERROR
                self._error = str(e)
            return

        with self._lock:
            self._status = (
                TrainingStatus.COMPLETE
                if not self._stop_event.is_set()
                else TrainingStatus.IDLE
            )

    # ── Status ───────────────────────────────────────────────────────────────────

    def get_status_dict(self) -> dict:
        with self._lock:
            return {
                "status": self._status,
                "current_epoch": self._current_epoch,
                "total_epochs": self._total_epochs,
                "loss": round(self._loss, 4),
                "accuracy": round(self._accuracy, 2),
                "error": self._error,
                "log": list(self._log),
                "checkpoint": checkpoint_info(CHECKPOINT_PATH),
            }

    # ── Inference ────────────────────────────────────────────────────────────────

    def predict_session(self, session_id: str) -> Optional[list[dict]]:
        """
        Run model inference on every word window in a saved session CSV.
        Returns None if the model has not been trained or the session is not found.
        """
        if not checkpoint_info(CHECKPOINT_PATH)["exists"]:
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
                    t = torch.tensor(arr).unsqueeze(0)
                    t = F.interpolate(t, size=256, mode="linear", align_corners=False).squeeze(0)
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
                "confidence": confidence,
                "has_eeg": has_eeg,
            })

        return results

    # ── Helpers ──────────────────────────────────────────────────────────────────

    def _find_csv(self, session_id: str) -> Optional[Path]:
        matches = list(self.data_dir.glob(f"session_{session_id}_*.csv"))
        return matches[0] if matches else None

    def _find_header_line(self, csv_path: Path) -> int:
        with open(csv_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if line.startswith("event,"):
                    return i
        return 0
