"""
BCI Data Collection - Pydantic Models
Data schemas for sessions, events, and API requests/responses.
"""

from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class EventType(str, Enum):
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    WORD_START = "word_start"
    WORD_END = "word_end"
    REST_START = "rest_start"
    REST_END = "rest_end"
    EEG_SAMPLE = "eeg_sample"


class EEGStatus(str, Enum):
    """EEG connection states."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    STREAMING = "streaming"
    ERROR = "error"


class ParticipantInfo(BaseModel):
    """Participant information collected in intake form."""
    name: str = Field(..., min_length=1)
    age: int = Field(..., ge=1, le=120)
    sex: str
    gender: str
    race: str
    total_trials: int = Field(..., ge=1, le=200)


class SessionConfig(BaseModel):
    """Session configuration derived from participant info."""
    session_id: str
    participant: ParticipantInfo
    words_per_trial: int = 10
    word_duration_ms: int = 5000
    rest_duration_ms: int = 2000
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class WordEvent(BaseModel):
    """Event data for word/rest transitions."""
    event_type: EventType
    word: Optional[str] = None
    word_id: Optional[int] = None
    trial: int
    timestamp: datetime
    relative_time_ms: int = 0


class SessionStartRequest(BaseModel):
    """Request body for starting a new session."""
    participant: ParticipantInfo


class SessionStartResponse(BaseModel):
    """Response after session is created."""
    session_id: str
    status: str = "ready"
    config: SessionConfig


class SessionSummary(BaseModel):
    """Summary data shown on completion screen."""
    session_id: str
    participant_name: str
    participant_age: int
    participant_sex: str
    participant_gender: str
    participant_race: str
    total_trials: int
    words_presented: int
    rest_periods: int
    start_time: datetime
    end_time: datetime
    total_duration_ms: int


# Socket.IO event payloads
class SocketWordStartEvent(BaseModel):
    """Payload for word_start socket event."""
    word: str
    word_id: int
    trial: int
    timestamp: str  # ISO format string from client


class SocketWordEndEvent(BaseModel):
    """Payload for word_end socket event."""
    word: str
    word_id: int
    trial: int
    timestamp: str


class SocketRestStartEvent(BaseModel):
    """Payload for rest_start socket event."""
    trial: int
    timestamp: str


class SocketRestEndEvent(BaseModel):
    """Payload for rest_end socket event."""
    trial: int
    timestamp: str


class SocketSessionStartEvent(BaseModel):
    """Payload for session_start socket event."""
    participant: ParticipantInfo


class MarkerLoggedResponse(BaseModel):
    """Response confirming marker was logged."""
    event_type: str
    timestamp: str
    success: bool = True


class EEGStatusResponse(BaseModel):
    """Response for EEG status queries."""
    status: EEGStatus
    hardware_available: bool
    port: Optional[str] = None
    error_message: Optional[str] = None
    sample_rate: int = 125
    num_channels: int = 16
