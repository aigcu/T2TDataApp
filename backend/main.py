"""
BCI Data Collection - FastAPI Application
Main entry point with REST API and Socket.IO integration.
"""

from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import socketio
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field as PydanticField

from constants import WORDS, WORD_DURATION_MS, REST_DURATION_MS, TRIAL_OPTIONS
from models import ParticipantInfo, SessionStartRequest, SessionStartResponse
from services.csv_service import CSVService
from services.session_service import SessionService
from services.eeg_service import EEGCollector
from services.training_service import TrainingService
from socket_handlers import setup_socket_handlers

# Initialize services
csv_service = CSVService()
session_service = SessionService(csv_service)
eeg_collector = EEGCollector()
training_service = TrainingService()

# Initialize Socket.IO
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
)

# Setup socket handlers with EEG collector
setup_socket_handlers(sio, session_service, eeg_collector)

# Attempt auto-connect to EEG hardware on startup
print("Attempting to auto-connect to EEG hardware...")
if eeg_collector.connect():
    print(f"EEG auto-connected on port: {eeg_collector.port}")
else:
    print(f"EEG auto-connect failed: {eeg_collector.error_message or 'No hardware found'}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    print("BCI Data Collection Server starting...")
    yield
    print("BCI Data Collection Server shutting down...")
    # Cleanup EEG connection on shutdown
    if eeg_collector:
        eeg_collector.disconnect()


# Create FastAPI app
app = FastAPI(
    title="BCI Data Collection API",
    description="API for automated BCI/EEG data collection with word stimuli",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# REST API Endpoints
@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/config")
async def get_config():
    """Get configuration for the frontend."""
    return {
        "words": WORDS,
        "word_duration_ms": WORD_DURATION_MS,
        "rest_duration_ms": REST_DURATION_MS,
        "trial_options": TRIAL_OPTIONS,
    }


@app.get("/api/eeg/status")
async def get_eeg_status():
    """Get current EEG hardware status."""
    return eeg_collector.get_status_dict()


@app.post("/api/eeg/connect")
async def connect_eeg():
    """Attempt to connect to EEG hardware."""
    success = eeg_collector.connect()
    return eeg_collector.get_status_dict()


@app.post("/api/session/start", response_model=SessionStartResponse)
async def start_session(request: SessionStartRequest):
    """Initialize a new session with participant info."""
    try:
        config = session_service.create_session(request.participant)
        return SessionStartResponse(
            session_id=config.session_id,
            status="ready",
            config=config,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session information."""
    config = session_service.get_session(session_id)
    if not config:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": config.session_id,
        "participant": config.participant.model_dump(),
        "start_time": config.start_time.isoformat() if config.start_time else None,
        "end_time": config.end_time.isoformat() if config.end_time else None,
    }


@app.post("/api/session/{session_id}/end")
async def end_session(session_id: str):
    """End a session and get summary."""
    summary = session_service.end_session(session_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Session not found")
    return summary.model_dump()


@app.get("/api/session/{session_id}/csv")
async def download_csv(session_id: str):
    """Download the session CSV file."""
    content = session_service.get_csv_content(session_id)
    if not content:
        raise HTTPException(status_code=404, detail="CSV file not found")

    filename = session_service.get_csv_filename(session_id) or f"{session_id}.csv"

    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@app.post("/api/session/{session_id}/save")
async def save_session(session_id: str):
    """Confirm session data is saved on the server."""
    filepath = csv_service.get_session_filepath(session_id)
    if not filepath:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "status": "saved",
        "session_id": session_id,
        "filepath": filepath,
        "message": "Session data saved successfully on server",
    }


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and its data."""
    deleted = session_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}


# ── Training / Model endpoints ────────────────────────────────────────────────

class TrainRequest(BaseModel):
    session_ids: list[str]
    epochs: int = PydanticField(default=50, ge=1, le=1000)


@app.get("/api/sessions/all")
async def list_all_sessions():
    """List metadata for every saved session CSV on disk."""
    return training_service.list_sessions()


@app.get("/api/model/status")
async def get_model_status():
    """Get current training status and checkpoint info."""
    return training_service.get_status_dict()


@app.post("/api/model/train")
async def start_training(request: TrainRequest):
    """Start training the EEG-to-text model on the selected sessions."""
    started = training_service.start_training(request.session_ids, request.epochs)
    if not started:
        raise HTTPException(status_code=409, detail="Training is already in progress")
    return {"status": "started", "epochs": request.epochs, "session_ids": request.session_ids}


@app.post("/api/model/stop")
async def stop_training():
    """Signal the training thread to stop after the current epoch."""
    training_service.stop_training()
    return {"status": "stop_requested"}


@app.get("/api/session/{session_id}/events")
async def get_session_events(session_id: str):
    """Return the event timeline for a session (used for playback)."""
    events = training_service.get_session_events(session_id)
    if events is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "events": events}


@app.get("/api/session/{session_id}/predict")
async def predict_session(session_id: str):
    """Run model inference on each word window in a saved session."""
    results = training_service.predict_session(session_id)
    if results is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found or no trained model checkpoint exists",
        )
    return {"session_id": session_id, "predictions": results}


# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


# Run with: uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:socket_app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
