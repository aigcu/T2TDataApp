# Thought-to-Text (T2T) EEG Data Collection App

A BCI data collection system for training a Thought-to-Text machine learning model. Participants imagine speaking 10 target words while 16-channel EEG data is recorded, timestamped, and exported as structured CSV files ready for model training.

## Features

- **16-Channel EEG Recording** — OpenBCI Cyton+Daisy at 125 Hz
- **10-Word Stimulus Protocol** — YES, NO, HELP, STOP, GO, WATER, FOOD, PAIN, MORE, NEED
- **Real-time Event Markers** — Socket.IO events sync EEG samples with stimulus onset/offset
- **Session Management** — Participant demographics, configurable trial counts
- **CSV Export** — Structured per-session files with word + EEG channels aligned by timestamp
- **ML-Ready Output** — CSV format parsed directly by `SimEEgN_LTSM_Train.ipynb`

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+ · FastAPI · python-socketio · BrainFlow |
| Frontend | React 19 · TypeScript · Vite · TailwindCSS · Socket.IO client |
| EEG Hardware | OpenBCI Cyton+Daisy · BrainFlow library |
| Data | CSV files in `backend/data/sessions/` |

---

## Hardware Requirements

### OpenBCI ThinkPulse / Cyton+Daisy Setup

| Component | Detail |
|---|---|
| Headset | OpenBCI ThinkPulse Active Electrode EEG Cap (16 ch) |
| Board | OpenBCI Cyton (8 ch) + Daisy Module (8 ch) = 16 ch total |
| Dongle | OpenBCI USB Radio Dongle (CP2104 / Silicon Labs chip) |
| Sample Rate | 125 Hz |
| Resolution | 24-bit |
| Connection | USB dongle → virtual COM port → BrainFlow → backend |

### Connecting the Dongle (Windows)

1. Plug the USB radio dongle into any USB port.
2. Windows will install the **Silicon Labs CP210x** driver automatically (or download from Silicon Labs if it fails).
3. Open **Device Manager → Ports (COM & LPT)** — note the `COMx` number (e.g. `COM3`).
4. Power on the Cyton board. The green LED should blink then stay solid — this means the board has paired with the dongle.
5. The backend auto-detects the port. If detection fails, set it manually (see Troubleshooting).

> **Note:** The Cyton communicates with its dongle over a 2.4 GHz radio link. The dongle itself presents as a standard serial (COM) port — BrainFlow uses `CYTON_DAISY_BOARD = 2` for the 16-channel configuration.

---

## Installation

### Prerequisites

- Python 3.11 or higher (tested on 3.11 and 3.14)
- Node.js 18+ and npm
- Git

### 1. Clone

```bash
git clone https://github.com/yourusername/T2TDataApp.git
cd T2TDataApp
```

### 2. Backend

```bash
cd backend
python -m venv ../venv
# Windows:
..\venv\Scripts\activate
# macOS/Linux:
source ../venv/bin/activate

pip install -r requirements.txt
```

### 3. Frontend

```bash
cd Frontend
npm install
```

---

## Running the App

### Quick Start (Windows — double-click)

Double-click **`start.bat`** in the project root. It will:
1. Kill any processes already on ports 8000 / 5173 / 5174
2. Open a terminal window for the backend (`http://localhost:8000`)
3. Open a terminal window for the frontend (`http://localhost:5173`)

### Manual Start

**Terminal 1 — Backend:**
```bash
cd backend
..\venv\Scripts\activate          # Windows
# source ../venv/bin/activate     # macOS/Linux
uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Frontend:**
```bash
cd Frontend
npm run dev          # standard start
# npm run fresh      # kills ports first, then starts
```

Open `http://localhost:5173` in your browser.

---

## Running a Session

1. **Fill in participant info** — name, age, sex, race, number of trials.
2. **Connect EEG** — click "Connect EEG" on the Ready screen. Status will change to "Connected".
3. **Click Start** — a 3-second countdown plays, then the word sequence begins.
4. **Word protocol per trial:**
   - 10 words × (5 s display + 2 s rest) = **70 seconds per trial**
   - Participant imagines speaking each word during its 5-second window
5. **Stop mid-session** — click the `✕ Stop` button (top-left) at any time to abort and delete the session.
6. **Save or Delete** — after the session completes, choose to save the CSV or discard.

### Trial Duration Reference

| Trials | Duration |
|---|---|
| 5 | ~6 min |
| 10 | ~12 min |
| 25 | ~29 min |
| 50 | ~58 min |
| 100 | ~117 min |

---

## Data Format

Session CSVs are saved to `backend/data/sessions/session_<timestamp>_<name>.csv`.

### Metadata header (first lines)
```
# session_id: ...
# participant: ...
# words_per_trial: 10
# word_duration_ms: 5000
# rest_duration_ms: 2000
```

### Data rows
```csv
event, word, word_id, trial, timestamp, relative_time_ms, ch1, ch2, ..., ch16
word_start, YES, 0, 1, 2025-01-01T10:00:00Z, 0, 12.5, 13.2, ..., 11.8
eeg_sample,    ,  , 1, 2025-01-01T10:00:00.008Z, 8, 12.6, ...
word_end,   YES, 0, 1, 2025-01-01T10:00:05Z, 5000, ...
rest_start,    ,  , 1, ...
rest_end,      ,  , 1, ...
```

| Column | Description |
|---|---|
| `event` | `word_start`, `word_end`, `rest_start`, `rest_end`, `eeg_sample` |
| `word` | Word name (YES, NO, …) — blank for eeg_sample rows |
| `word_id` | Word index 0–9 |
| `trial` | Trial number (1-based) |
| `timestamp` | ISO 8601 UTC |
| `relative_time_ms` | ms since session start |
| `ch1`–`ch16` | EEG channel values in µV |

---

## ML Training

After collecting sessions, train the EEGNet+LSTM model:

```bash
# From project root (venv active)
jupyter notebook "SimEEgN_LTSM_Train (1).ipynb"
```

The notebook automatically detects CSV files in `backend/data/sessions/`:
- If sessions exist → trains on real EEG data (`RealEEGDataset`)
- If no sessions yet → trains on simulated data (`EEGDataset`) for testing

---

## API Reference

### REST

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/config` | Stimulus config (words, timing) |
| GET | `/api/eeg/status` | EEG hardware status |
| DELETE | `/api/session/{id}` | Delete session and CSV |
| POST | `/api/session/{id}/save` | Flush session to disk |

### Socket.IO Events (client → server)

| Event | Payload | Description |
|---|---|---|
| `start_session` | participant info | Begin EEG streaming |
| `word_start` | `{word, word_id, trial, timestamp}` | Stimulus onset marker |
| `word_end` | `{word, word_id, trial, timestamp}` | Stimulus offset marker |
| `rest_start` | `{trial, timestamp}` | Rest period start |
| `rest_end` | `{trial, timestamp}` | Rest period end |
| `end_session` | — | Stop streaming, finalize CSV |

---

## Troubleshooting

### EEG not connecting

**Check LED states:**
- Cyton board **solid blue** = powered, not paired
- Cyton board **green blink** = pairing with dongle
- Cyton board **solid green** = paired and ready

**Windows — driver not installed:**
1. Open Device Manager
2. Look for unknown device or "CP210x"
3. Download Silicon Labs CP210x driver and install
4. Replug the dongle

**Port not auto-detected:**
The backend logs which port it finds. If detection fails:
1. Open Device Manager → Ports (COM & LPT)
2. Note the COMx number (e.g. `COM5`)
3. Set it in `backend/services/eeg_service.py` by changing the `EEGCollector` instantiation in `socket_handlers.py` to pass `port="COM5"` explicitly

**Another app using the port:**
Close OpenBCI GUI, Arduino IDE, or any other serial monitor before running this app.

**Cyton not paired to dongle:**
- Make sure the dongle is plugged in *before* powering on the Cyton board
- The board pairs on power-up; re-power the board after inserting the dongle

### Frontend can't reach backend

- Confirm backend is running: `curl http://localhost:8000/api/health`
- Check firewall allows port 8000
- Ensure `VITE_API_URL` in `.env` matches the backend address (default: `http://localhost:8000`)

### Data looks flat / all zeros

- The board may be streaming but electrodes aren't making contact
- Check gel/contact quality on ThinkPulse cap electrodes
- Confirm Daisy module is firmly seated on Cyton board

### Validating recorded data

```bash
python scripts/parse_session.py backend/data/sessions/session_YYYYMMDD_HHMMSS_name.csv
```

Checks sample rate accuracy, data loss %, per-trial capture rate, and channel health.
