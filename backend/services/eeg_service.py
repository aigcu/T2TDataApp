"""
BCI Data Collection - EEG Service
Handles OpenBCI Cyton+Daisy connection and streaming via BrainFlow.
"""

import glob
import platform
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Optional

try:
    from brainflow.board_shim import BoardIds, BoardShim, BrainFlowInputParams
    BRAINFLOW_AVAILABLE = True
except ImportError:
    BRAINFLOW_AVAILABLE = False


class EEGStatus(str, Enum):
    """EEG connection states."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    STREAMING = "streaming"
    ERROR = "error"


@dataclass
class EEGSample:
    """Single EEG sample with 16 channel values."""
    relative_time_ms: int
    channels: list[float]  # 16 values in microvolts


class EEGCollector:
    """
    Manages OpenBCI Cyton+Daisy EEG data collection.

    Uses BrainFlow library for cross-platform serial communication.
    Cyton+Daisy provides 16 channels at 125 Hz sample rate.
    """

    BOARD_ID = BoardIds.CYTON_DAISY_BOARD if BRAINFLOW_AVAILABLE else None
    SAMPLE_RATE = 125  # Hz (Cyton+Daisy limitation)
    NUM_CHANNELS = 16

    def __init__(self, port: Optional[str] = None):
        """
        Initialize EEG collector.

        Args:
            port: Serial port path. If None, will auto-detect.
        """
        self._port = port
        self._board: Optional[BoardShim] = None
        self._status = EEGStatus.DISCONNECTED
        self._error_message: Optional[str] = None
        self._streaming_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._callback: Optional[Callable[[EEGSample], None]] = None
        self._start_time: Optional[datetime] = None

    def _detect_port(self) -> Optional[str]:
        """
        Auto-detect OpenBCI serial port based on platform.

        Returns:
            Serial port path or None if not found.
        """
        system = platform.system()

        if system == "Darwin":  # macOS
            # OpenBCI uses FTDI chip, appears as cu.usbserial-*
            ports = glob.glob("/dev/cu.usbserial-*")
        elif system == "Windows":
            # Use pyserial to list COM ports
            try:
                import serial.tools.list_ports
                ports = [p.device for p in serial.tools.list_ports.comports()
                        if "USB" in p.description or "Serial" in p.description]
            except ImportError:
                ports = []
        else:  # Linux
            ports = glob.glob("/dev/ttyUSB*")

        return ports[0] if ports else None

    @property
    def status(self) -> EEGStatus:
        """Current connection status."""
        return self._status

    @property
    def error_message(self) -> Optional[str]:
        """Last error message if status is ERROR."""
        return self._error_message

    @property
    def is_hardware_available(self) -> bool:
        """Whether hardware is connected and ready."""
        return self._status in (EEGStatus.CONNECTED, EEGStatus.STREAMING)

    @property
    def port(self) -> Optional[str]:
        """Current or detected serial port."""
        return self._port

    def connect(self) -> bool:
        """
        Connect to OpenBCI Cyton+Daisy board.

        Returns:
            True if connection successful, False otherwise.
        """
        if not BRAINFLOW_AVAILABLE:
            self._status = EEGStatus.ERROR
            self._error_message = "BrainFlow library not installed"
            return False

        # If already connected with a valid board, return success
        # This prevents overwriting _board reference when called multiple times
        if self._status in (EEGStatus.CONNECTED, EEGStatus.STREAMING) and self._board:
            print(f"EEG already connected on {self._port}")
            return True

        self._status = EEGStatus.CONNECTING
        self._error_message = None

        # Detect or use provided port
        port = self._port or self._detect_port()
        if not port:
            self._status = EEGStatus.DISCONNECTED
            self._error_message = "No serial port found"
            return False

        try:
            params = BrainFlowInputParams()
            params.serial_port = port

            self._board = BoardShim(self.BOARD_ID, params)
            self._board.prepare_session()

            self._status = EEGStatus.CONNECTED
            self._port = port
            print(f"EEG connected on {port}")
            return True

        except Exception as e:
            error_str = str(e)
            # Handle case where board session already exists
            if "ANOTHER_BOARD_IS_CREATED_ERROR" in error_str:
                # Board already prepared - treat as connected
                self._status = EEGStatus.CONNECTED
                self._port = port
                self._error_message = None
                print(f"EEG already connected on {port} (board session exists)")
                return True

            self._status = EEGStatus.ERROR
            self._error_message = error_str
            self._board = None
            print(f"EEG connection failed: {e}")
            return False

    def start_streaming(
        self,
        callback: Callable[[EEGSample], None],
        start_time: datetime
    ) -> bool:
        """
        Start EEG data streaming in background thread.

        Args:
            callback: Function called for each EEG sample (runs in background thread).
            start_time: Session start time for calculating relative timestamps.

        Returns:
            True if streaming started, False if not connected.
        """
        if not self._board or self._status != EEGStatus.CONNECTED:
            return False

        self._callback = callback
        self._start_time = start_time
        self._stop_event.clear()

        try:
            self._board.start_stream()
            self._status = EEGStatus.STREAMING

            # Start background thread for reading samples
            self._streaming_thread = threading.Thread(
                target=self._stream_loop,
                daemon=True,
                name="EEG-StreamThread"
            )
            self._streaming_thread.start()

            print("EEG streaming started")
            return True

        except Exception as e:
            self._status = EEGStatus.ERROR
            self._error_message = f"Failed to start stream: {e}"
            print(f"EEG streaming failed: {e}")
            return False

    def _stream_loop(self) -> None:
        """Background thread loop for reading EEG samples."""
        if not BRAINFLOW_AVAILABLE:
            return

        # Get EEG channel indices for Cyton+Daisy (channels 1-16)
        eeg_channels = BoardShim.get_eeg_channels(self.BOARD_ID)

        while not self._stop_event.is_set():
            try:
                # Get all available samples from board buffer
                data = self._board.get_board_data()

                if data.shape[1] > 0:
                    # Process each sample
                    for i in range(data.shape[1]):
                        # Calculate relative time from session start
                        now = datetime.now(timezone.utc)
                        relative_ms = int(
                            (now - self._start_time).total_seconds() * 1000
                        )

                        # Extract 16 channel values
                        channels = [float(data[ch][i]) for ch in eeg_channels]

                        # Call the callback (which writes to CSV)
                        if self._callback:
                            sample = EEGSample(
                                relative_time_ms=relative_ms,
                                channels=channels
                            )
                            self._callback(sample)

            except Exception as e:
                # Log error but keep trying
                print(f"EEG sample error: {e}")

            # Poll slightly faster than sample rate to avoid buffer overflow
            # Board samples at 125 Hz (8ms), we poll at ~250 Hz (4ms)
            time.sleep(0.004)

    def stop_streaming(self) -> None:
        """Stop EEG streaming."""
        self._stop_event.set()

        if self._streaming_thread and self._streaming_thread.is_alive():
            self._streaming_thread.join(timeout=1.0)

        if self._board and self._status == EEGStatus.STREAMING:
            try:
                self._board.stop_stream()
            except Exception as e:
                print(f"Error stopping stream: {e}")

        if self._status == EEGStatus.STREAMING:
            self._status = EEGStatus.CONNECTED

        self._callback = None
        print("EEG streaming stopped")

    def disconnect(self) -> None:
        """Disconnect from board and cleanup resources."""
        self.stop_streaming()

        if self._board:
            try:
                self._board.release_session()
            except Exception as e:
                print(f"Error releasing session: {e}")
            self._board = None

        self._status = EEGStatus.DISCONNECTED
        print("EEG disconnected")

    def get_status_dict(self) -> dict:
        """Get status as dictionary for socket emission."""
        return {
            "status": self._status.value,
            "hardware_available": self.is_hardware_available,
            "port": self._port,
            "error_message": self._error_message,
            "sample_rate": self.SAMPLE_RATE,
            "num_channels": self.NUM_CHANNELS,
        }
