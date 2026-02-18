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

from constants import COLORS, COLOR_DURATION_MS, REST_DURATION_MS, TRIAL_OPTIONS
from models import ParticipantInfo, SessionStartRequest, SessionStartResponse
from services.csv_service import CSVService
from services.session_service import SessionService
from services.eeg_service import EEGCollector
from socket_handlers import setup_socket_handlers

# Initialize services
csv_service = CSVService()
session_service = SessionService(csv_service)
eeg_collector = EEGCollector()

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
    description="API for automated BCI/EEG data collection with color stimuli",
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
        "colors": COLORS,
        "color_duration_ms": COLOR_DURATION_MS,
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
