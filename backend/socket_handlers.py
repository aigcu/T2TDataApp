"""
BCI Data Collection - Socket.IO Event Handlers
Handles real-time WebSocket events for word/rest marker logging and EEG control.
"""

from datetime import datetime
from typing import Any, Optional
import socketio

from models import (
    WordEvent,
    EventType,
    ParticipantInfo,
    SocketWordEndEvent,
    SocketWordStartEvent,
    SocketRestEndEvent,
    SocketRestStartEvent,
    SocketSessionStartEvent,
)
from services.session_service import SessionService
from services.eeg_service import EEGCollector, EEGStatus, EEGSample


def setup_socket_handlers(
    sio: socketio.AsyncServer,
    session_service: SessionService,
    eeg_collector: Optional[EEGCollector] = None,
):
    """Register all Socket.IO event handlers."""

    # Track active streaming sessions
    _streaming_sessions: dict[str, str] = {}  # sid -> session_id

    @sio.event
    async def connect(sid: str, environ: dict):
        """Handle client connection."""
        print(f"Client connected: {sid}")
        # Send initial EEG status
        if eeg_collector:
            await sio.emit("eeg_status", eeg_collector.get_status_dict(), room=sid)

    @sio.event
    async def disconnect(sid: str):
        """Handle client disconnection."""
        print(f"Client disconnected: {sid}")
        # Stop EEG streaming if this client was streaming
        if sid in _streaming_sessions and eeg_collector:
            eeg_collector.stop_streaming()
            del _streaming_sessions[sid]

    @sio.event
    async def get_eeg_status(sid: str):
        """Return current EEG connection status to client."""
        if eeg_collector:
            await sio.emit("eeg_status", eeg_collector.get_status_dict(), room=sid)
        else:
            await sio.emit(
                "eeg_status",
                {
                    "status": "disconnected",
                    "hardware_available": False,
                    "error_message": "EEG collector not initialized",
                },
                room=sid,
            )

    @sio.event
    async def connect_eeg(sid: str):
        """Attempt to connect to EEG hardware."""
        if not eeg_collector:
            await sio.emit(
                "eeg_status",
                {
                    "status": "error",
                    "hardware_available": False,
                    "error_message": "EEG collector not initialized",
                },
                room=sid,
            )
            return

        try:
            success = eeg_collector.connect()
            await sio.emit("eeg_status", eeg_collector.get_status_dict(), room=sid)
            if success:
                print(f"EEG connected for client {sid}")
            else:
                print(f"EEG connection failed for client {sid}")
        except Exception as e:
            await sio.emit(
                "eeg_status",
                {
                    "status": "error",
                    "hardware_available": False,
                    "error_message": str(e),
                },
                room=sid,
            )

    @sio.event
    async def session_start(sid: str, data: dict[str, Any]):
        """
        Handle session_start event from client.
        Creates a new session and starts EEG streaming if connected.
        """
        try:
            event_data = SocketSessionStartEvent(**data)
            participant = ParticipantInfo(**event_data.participant.model_dump())

            # Check if EEG is connected
            eeg_streaming = False
            if eeg_collector and eeg_collector.status == EEGStatus.CONNECTED:
                eeg_streaming = True

            # Create session (with EEG enabled if connected)
            config = session_service.create_session(
                participant, eeg_enabled=eeg_streaming
            )

            # Start EEG streaming if connected
            if eeg_streaming and config.start_time:
                def on_eeg_sample(sample: EEGSample):
                    """Callback for EEG samples - runs in background thread."""
                    session_service.log_eeg_sample(
                        config.session_id,
                        sample.relative_time_ms,
                        sample.channels,
                    )

                eeg_collector.start_streaming(on_eeg_sample, config.start_time)
                _streaming_sessions[sid] = config.session_id
                print(f"EEG streaming started for session {config.session_id}")

            # Send confirmation back to client
            await sio.emit(
                "session_created",
                {
                    "session_id": config.session_id,
                    "status": "ready",
                    "eeg_streaming": eeg_streaming,
                    "config": {
                        "words_per_trial": config.words_per_trial,
                        "word_duration_ms": config.word_duration_ms,
                        "rest_duration_ms": config.rest_duration_ms,
                        "total_trials": config.participant.total_trials,
                    },
                },
                room=sid,
            )

            # Store session_id in socket session
            async with sio.session(sid) as session:
                session["session_id"] = config.session_id

            print(f"Session created: {config.session_id} for {participant.name}")

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)

    @sio.event
    async def word_start(sid: str, data: dict[str, Any]):
        """Handle word_start event - word stimulus begins."""
        try:
            event_data = SocketWordStartEvent(**data)

            async with sio.session(sid) as session:
                session_id = session.get("session_id")

            if not session_id:
                await sio.emit("error", {"message": "No active session"}, room=sid)
                return

            # Parse timestamp
            timestamp = datetime.fromisoformat(
                event_data.timestamp.replace("Z", "+00:00")
            )

            event = WordEvent(
                event_type=EventType.WORD_START,
                word=event_data.word,
                word_id=event_data.word_id,
                trial=event_data.trial,
                timestamp=timestamp,
            )

            session_service.log_event(session_id, event)

            await sio.emit(
                "marker_logged",
                {
                    "event_type": "word_start",
                    "word": event_data.word,
                    "trial": event_data.trial,
                    "timestamp": event_data.timestamp,
                    "success": True,
                },
                room=sid,
            )

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)

    @sio.event
    async def word_end(sid: str, data: dict[str, Any]):
        """Handle word_end event - word stimulus ends."""
        try:
            event_data = SocketWordEndEvent(**data)

            async with sio.session(sid) as session:
                session_id = session.get("session_id")

            if not session_id:
                await sio.emit("error", {"message": "No active session"}, room=sid)
                return

            timestamp = datetime.fromisoformat(
                event_data.timestamp.replace("Z", "+00:00")
            )

            event = WordEvent(
                event_type=EventType.WORD_END,
                word=event_data.word,
                word_id=event_data.word_id,
                trial=event_data.trial,
                timestamp=timestamp,
            )

            session_service.log_event(session_id, event)

            await sio.emit(
                "marker_logged",
                {
                    "event_type": "word_end",
                    "word": event_data.word,
                    "trial": event_data.trial,
                    "timestamp": event_data.timestamp,
                    "success": True,
                },
                room=sid,
            )

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)

    @sio.event
    async def rest_start(sid: str, data: dict[str, Any]):
        """Handle rest_start event - rest period begins."""
        try:
            event_data = SocketRestStartEvent(**data)

            async with sio.session(sid) as session:
                session_id = session.get("session_id")

            if not session_id:
                await sio.emit("error", {"message": "No active session"}, room=sid)
                return

            timestamp = datetime.fromisoformat(
                event_data.timestamp.replace("Z", "+00:00")
            )

            event = WordEvent(
                event_type=EventType.REST_START,
                trial=event_data.trial,
                timestamp=timestamp,
            )

            session_service.log_event(session_id, event)

            await sio.emit(
                "marker_logged",
                {
                    "event_type": "rest_start",
                    "trial": event_data.trial,
                    "timestamp": event_data.timestamp,
                    "success": True,
                },
                room=sid,
            )

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)

    @sio.event
    async def rest_end(sid: str, data: dict[str, Any]):
        """Handle rest_end event - rest period ends."""
        try:
            event_data = SocketRestEndEvent(**data)

            async with sio.session(sid) as session:
                session_id = session.get("session_id")

            if not session_id:
                await sio.emit("error", {"message": "No active session"}, room=sid)
                return

            timestamp = datetime.fromisoformat(
                event_data.timestamp.replace("Z", "+00:00")
            )

            event = WordEvent(
                event_type=EventType.REST_END,
                trial=event_data.trial,
                timestamp=timestamp,
            )

            session_service.log_event(session_id, event)

            await sio.emit(
                "marker_logged",
                {
                    "event_type": "rest_end",
                    "trial": event_data.trial,
                    "timestamp": event_data.timestamp,
                    "success": True,
                },
                room=sid,
            )

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)

    @sio.event
    async def session_end(sid: str, data: dict[str, Any] = None):
        """Handle session_end event - session is complete."""
        try:
            async with sio.session(sid) as session:
                session_id = session.get("session_id")

            if not session_id:
                await sio.emit("error", {"message": "No active session"}, room=sid)
                return

            # Stop EEG streaming first
            if sid in _streaming_sessions and eeg_collector:
                eeg_collector.stop_streaming()
                del _streaming_sessions[sid]
                print(f"EEG streaming stopped for session {session_id}")

            summary = session_service.end_session(session_id)

            if summary:
                await sio.emit(
                    "session_complete",
                    {
                        "session_id": summary.session_id,
                        "participant_name": summary.participant_name,
                        "participant_age": summary.participant_age,
                        "participant_sex": summary.participant_sex,
                        "participant_gender": summary.participant_gender,
                        "participant_race": summary.participant_race,
                        "total_trials": summary.total_trials,
                        "words_presented": summary.words_presented,
                        "rest_periods": summary.rest_periods,
                        "total_duration_ms": summary.total_duration_ms,
                        "start_time": summary.start_time.isoformat() + "Z",
                        "end_time": summary.end_time.isoformat() + "Z",
                    },
                    room=sid,
                )

                print(f"Session ended: {session_id}")

            # Send updated EEG status (back to connected, not streaming)
            if eeg_collector:
                await sio.emit("eeg_status", eeg_collector.get_status_dict(), room=sid)

        except Exception as e:
            await sio.emit("error", {"message": str(e)}, room=sid)
