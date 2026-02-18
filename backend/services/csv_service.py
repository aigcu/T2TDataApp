"""
BCI Data Collection - CSV Service
Handles creation, writing, and management of session CSV files.
Thread-safe for concurrent EEG sample and event writes.
"""

import csv
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from constants import (
    COLORS_PER_TRIAL,
    COLOR_DURATION_MS,
    DATA_DIR,
    REST_DURATION_MS,
)
from models import ColorEvent, EventType, SessionConfig

# EEG constants
EEG_SAMPLE_RATE = 125  # Hz (Cyton+Daisy)
EEG_NUM_CHANNELS = 16


class CSVService:
    """
    Service for managing session CSV files.

    Thread-safe: Uses per-session locks for concurrent EEG sample
    and event writes from different threads.
    """

    def __init__(self, base_path: str = DATA_DIR):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._active_sessions: dict[str, dict] = {}
        self._file_locks: dict[str, threading.Lock] = {}

    def _get_lock(self, session_id: str) -> threading.Lock:
        """Get or create a lock for a session's file."""
        if session_id not in self._file_locks:
            self._file_locks[session_id] = threading.Lock()
        return self._file_locks[session_id]

    def _cleanup_lock(self, session_id: str) -> None:
        """Remove lock when session ends."""
        if session_id in self._file_locks:
            del self._file_locks[session_id]

    def _generate_filename(self, session_id: str, participant_name: str) -> str:
        """Generate filename: session_{timestamp}_{name}.csv"""
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", participant_name.lower())
        safe_name = safe_name[:50]  # Limit length
        return f"session_{session_id}_{safe_name}.csv"

    def _get_filepath(self, session_id: str) -> Optional[Path]:
        """Get the filepath for an active session."""
        if session_id in self._active_sessions:
            return self._active_sessions[session_id]["filepath"]
        return None

    def create_session_file(
        self, config: SessionConfig, eeg_enabled: bool = False
    ) -> str:
        """Create a new CSV file for a session and write metadata header."""
        filename = self._generate_filename(
            config.session_id, config.participant.name
        )
        filepath = self.base_path / filename

        # Store session info
        self._active_sessions[config.session_id] = {
            "filepath": filepath,
            "config": config,
            "start_time": config.start_time or datetime.now(timezone.utc),
            "event_count": 0,
            "eeg_sample_count": 0,
            "eeg_enabled": eeg_enabled,
        }

        # Create lock for this session
        self._get_lock(config.session_id)

        # Write metadata and headers
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            # Metadata section
            f.write(f"session_id,{config.session_id}\n")
            f.write(f"participant_name,{config.participant.name}\n")
            f.write(f"participant_age,{config.participant.age}\n")
            f.write(f"participant_sex,{config.participant.sex}\n")
            f.write(f"participant_gender,{config.participant.gender}\n")
            f.write(f"participant_race,{config.participant.race}\n")
            f.write(f"total_trials,{config.participant.total_trials}\n")
            f.write(f"colors_per_trial,{COLORS_PER_TRIAL}\n")
            f.write(f"color_duration_ms,{COLOR_DURATION_MS}\n")
            f.write(f"rest_duration_ms,{REST_DURATION_MS}\n")
            # EEG metadata
            f.write(f"eeg_enabled,{str(eeg_enabled).lower()}\n")
            f.write(f"eeg_sample_rate_hz,{EEG_SAMPLE_RATE}\n")
            f.write(f"eeg_channels,{EEG_NUM_CHANNELS}\n")
            start_time = config.start_time or datetime.now(timezone.utc)
            f.write(f"start_time,{start_time.isoformat()}Z\n")
            f.write("end_time,\n")  # Placeholder, filled on finalization
            f.write("\n")  # Blank line separator

            # Event data headers (including 16 EEG channels)
            writer = csv.writer(f)
            header = [
                "event",
                "color",
                "color_id",
                "trial",
                "timestamp",
                "relative_time_ms",
            ]
            # Add 16 channel columns
            header.extend([f"ch{i}" for i in range(1, EEG_NUM_CHANNELS + 1)])
            writer.writerow(header)

        return str(filepath)

    def append_event(self, session_id: str, event: ColorEvent) -> bool:
        """
        Append an event row to the session CSV file.

        Thread-safe: Uses per-session lock.
        Event rows have empty channel columns.
        """
        if session_id not in self._active_sessions:
            return False

        filepath = self._active_sessions[session_id]["filepath"]
        lock = self._get_lock(session_id)

        with lock:
            self._active_sessions[session_id]["event_count"] += 1

            with open(filepath, "a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                row = [
                    event.event_type.value,
                    event.color or "",
                    event.color_id if event.color_id is not None else "",
                    event.trial,
                    f"{event.timestamp.isoformat()}Z",
                    event.relative_time_ms,
                ]
                # Add empty channel columns for event rows
                row.extend([""] * EEG_NUM_CHANNELS)
                writer.writerow(row)

        return True

    def append_eeg_sample(
        self,
        session_id: str,
        relative_time_ms: int,
        channels: list[float]
    ) -> bool:
        """
        Append an EEG sample row to the session CSV file.

        Thread-safe: Uses per-session lock.
        EEG rows have empty event fields (color, color_id, trial, timestamp).

        Args:
            session_id: Active session ID
            relative_time_ms: Time since session start in milliseconds
            channels: List of 16 channel values in microvolts
        """
        if session_id not in self._active_sessions:
            return False

        filepath = self._active_sessions[session_id]["filepath"]
        lock = self._get_lock(session_id)

        with lock:
            self._active_sessions[session_id]["eeg_sample_count"] += 1

            with open(filepath, "a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                row = [
                    "eeg_sample",  # event type
                    "",  # color (empty for EEG)
                    "",  # color_id (empty)
                    "",  # trial (empty)
                    "",  # timestamp (empty - use relative_time_ms)
                    relative_time_ms,
                ]
                # Add channel values (round to 2 decimal places)
                row.extend([round(ch, 2) for ch in channels])
                writer.writerow(row)

        return True

    def finalize_session(self, session_id: str, end_time: datetime) -> Optional[str]:
        """Update the end_time in the metadata and close the session."""
        if session_id not in self._active_sessions:
            return None

        filepath = self._active_sessions[session_id]["filepath"]
        lock = self._get_lock(session_id)

        with lock:
            # Read the file and update end_time
            with open(filepath, "r", encoding="utf-8") as f:
                lines = f.readlines()

            # Find and update the end_time line
            for i, line in enumerate(lines):
                if line.startswith("end_time,"):
                    lines[i] = f"end_time,{end_time.isoformat()}Z\n"
                    break

            # Write back
            with open(filepath, "w", encoding="utf-8") as f:
                f.writelines(lines)

        # Clean up
        del self._active_sessions[session_id]
        self._cleanup_lock(session_id)

        return str(filepath)

    def delete_session(self, session_id: str) -> bool:
        """Delete a session's CSV file."""
        # Check active sessions
        if session_id in self._active_sessions:
            filepath = self._active_sessions[session_id]["filepath"]
            del self._active_sessions[session_id]
            self._cleanup_lock(session_id)
        else:
            # Try to find the file by session_id prefix
            matching_files = list(self.base_path.glob(f"session_{session_id}_*.csv"))
            if not matching_files:
                return False
            filepath = matching_files[0]

        try:
            os.remove(filepath)
            return True
        except OSError:
            return False

    def get_session_filepath(self, session_id: str) -> Optional[str]:
        """Get the filepath for a session (active or completed)."""
        if session_id in self._active_sessions:
            return str(self._active_sessions[session_id]["filepath"])

        # Try to find completed session file
        matching_files = list(self.base_path.glob(f"session_{session_id}_*.csv"))
        if matching_files:
            return str(matching_files[0])

        return None

    def read_session_csv(self, session_id: str) -> Optional[bytes]:
        """Read and return the full CSV content for download."""
        filepath = self.get_session_filepath(session_id)
        if not filepath or not os.path.exists(filepath):
            return None

        with open(filepath, "rb") as f:
            return f.read()

    def get_session_info(self, session_id: str) -> Optional[dict]:
        """Get info about an active session."""
        if session_id in self._active_sessions:
            return self._active_sessions[session_id]
        return None
