"""
BCI Data Collection - Session Service
Manages session lifecycle and coordinates with CSV service.
"""

from datetime import datetime, timezone
from typing import Optional

from constants import COLORS_PER_TRIAL, COLOR_DURATION_MS, REST_DURATION_MS
from models import (
    ColorEvent,
    EventType,
    ParticipantInfo,
    SessionConfig,
    SessionSummary,
)
from services.csv_service import CSVService


class SessionService:
    """Service for managing BCI data collection sessions."""

    def __init__(self, csv_service: CSVService):
        self.csv_service = csv_service
        self._sessions: dict[str, SessionConfig] = {}
        self._session_events: dict[str, list[ColorEvent]] = {}

    def _generate_session_id(self) -> str:
        """Generate a unique session ID: YYYYMMDD_HHMMSS."""
        now = datetime.now(timezone.utc)
        return now.strftime("%Y%m%d_%H%M%S")

    def create_session(
        self, participant: ParticipantInfo, eeg_enabled: bool = False
    ) -> SessionConfig:
        """Create a new session for a participant."""
        session_id = self._generate_session_id()
        start_time = datetime.now(timezone.utc)

        config = SessionConfig(
            session_id=session_id,
            participant=participant,
            colors_per_trial=COLORS_PER_TRIAL,
            color_duration_ms=COLOR_DURATION_MS,
            rest_duration_ms=REST_DURATION_MS,
            start_time=start_time,
        )

        self._sessions[session_id] = config
        self._session_events[session_id] = []

        # Create the CSV file (with EEG columns if enabled)
        self.csv_service.create_session_file(config, eeg_enabled=eeg_enabled)

        # Log session start event
        start_event = ColorEvent(
            event_type=EventType.SESSION_START,
            trial=0,
            timestamp=start_time,
            relative_time_ms=0,
        )
        self.log_event(session_id, start_event)

        return config

    def get_session(self, session_id: str) -> Optional[SessionConfig]:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def log_event(self, session_id: str, event: ColorEvent) -> bool:
        """Log an event to the session."""
        if session_id not in self._sessions:
            return False

        # Calculate relative time if not set
        if event.relative_time_ms == 0 and event.event_type != EventType.SESSION_START:
            config = self._sessions[session_id]
            if config.start_time:
                delta = event.timestamp - config.start_time
                event.relative_time_ms = int(delta.total_seconds() * 1000)

        self._session_events[session_id].append(event)
        return self.csv_service.append_event(session_id, event)

    def log_eeg_sample(
        self, session_id: str, relative_time_ms: int, channels: list[float]
    ) -> bool:
        """
        Log an EEG sample to the session CSV.

        Called from background thread - thread-safe via CSVService locks.

        Args:
            session_id: Active session ID
            relative_time_ms: Time since session start in milliseconds
            channels: List of 16 channel values in microvolts
        """
        if session_id not in self._sessions:
            return False

        return self.csv_service.append_eeg_sample(
            session_id, relative_time_ms, channels
        )

    def end_session(self, session_id: str) -> Optional[SessionSummary]:
        """End a session and generate summary."""
        if session_id not in self._sessions:
            return None

        config = self._sessions[session_id]
        end_time = datetime.now(timezone.utc)

        # Log session end event
        end_event = ColorEvent(
            event_type=EventType.SESSION_END,
            trial=config.participant.total_trials,
            timestamp=end_time,
            relative_time_ms=0,
        )
        self.log_event(session_id, end_event)

        # Finalize CSV
        self.csv_service.finalize_session(session_id, end_time)

        # Calculate statistics
        events = self._session_events.get(session_id, [])
        colors_presented = sum(
            1 for e in events if e.event_type == EventType.COLOR_START
        )
        rest_periods = sum(
            1 for e in events if e.event_type == EventType.REST_START
        )

        start_time = config.start_time or end_time
        total_duration_ms = int((end_time - start_time).total_seconds() * 1000)

        summary = SessionSummary(
            session_id=session_id,
            participant_name=config.participant.name,
            participant_age=config.participant.age,
            participant_sex=config.participant.sex,
            participant_gender=config.participant.gender,
            participant_race=config.participant.race,
            total_trials=config.participant.total_trials,
            colors_presented=colors_presented,
            rest_periods=rest_periods,
            start_time=start_time,
            end_time=end_time,
            total_duration_ms=total_duration_ms,
        )

        # Update session config
        config.end_time = end_time

        return summary

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and its data."""
        # Delete CSV file
        csv_deleted = self.csv_service.delete_session(session_id)

        # Clean up memory
        if session_id in self._sessions:
            del self._sessions[session_id]
        if session_id in self._session_events:
            del self._session_events[session_id]

        return csv_deleted

    def get_csv_content(self, session_id: str) -> Optional[bytes]:
        """Get the CSV file content for download."""
        return self.csv_service.read_session_csv(session_id)

    def get_csv_filename(self, session_id: str) -> Optional[str]:
        """Get the CSV filename for a session."""
        filepath = self.csv_service.get_session_filepath(session_id)
        if filepath:
            return filepath.split("/")[-1]
        return None
