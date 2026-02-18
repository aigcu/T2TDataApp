# EEG Data Collection System with OpenBCI Cyton+Daisy

A professional-grade EEG data collection system designed for Brain-Computer Interface (BCI) research. This system presents color stimuli to participants while recording 16-channel EEG data using the OpenBCI Cyton+Daisy biosensing board.

## 🧠 Features

- **16-Channel EEG Recording**: Full support for OpenBCI Cyton+Daisy board (125 Hz sample rate)
- **Automated Stimulus Presentation**: Sequential display of 7 distinct colors with precise timing
- **Real-time Data Streaming**: WebSocket-based live EEG data transmission
- **Session Management**: Participant information tracking and session organization
- **CSV Data Export**: Structured data output with timestamps and channel readings
- **Local Development**: Simple Python backend and React frontend setup
- **Web-based Interface**: React frontend for experiment control and monitoring
- **Hardware Auto-detection**: Automatic serial port discovery for OpenBCI devices

## 🛠 Technology Stack

- **Backend**: Python 3.11 + FastAPI + BrainFlow
- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Communication**: Socket.IO for real-time data streaming
- **Data Storage**: CSV files with structured session data
- **Deployment**: Local Python + Node.js
- **EEG Interface**: BrainFlow library for OpenBCI hardware communication

## 🔧 Hardware Requirements

### OpenBCI Cyton+Daisy Board
- **Model**: OpenBCI Cyton (8-channel) + Daisy Module (8 additional channels)
- **Total Channels**: 16 EEG channels
- **Sample Rate**: 125 Hz
- **Resolution**: 24-bit
- **Connection**: USB dongle with FTDI serial interface
- **Power**: Rechargeable battery or USB power

## 🚀 Installation & Setup

### Prerequisites

1. **Python 3.11+** installed on your system
2. **Node.js 18+** and npm
3. **OpenBCI Cyton+Daisy** board with USB dongle
4. **Git** for cloning the repository

### Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/EEG-Data-Collection.git
cd EEG-Data-Collection
```

### Step 2: Install and Run

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py

# Frontend (new terminal)
cd Frontend
npm install
npm run dev
```

### Step 3: Verify Connection

1. Access the web interface: http://localhost:5173
2. Check the EEG hardware status indicator (should show "Connected")
3. The backend will auto-detect your OpenBCI device

## 💻 Usage

### Starting a Data Collection Session

1. **Access the Web Interface**
   - Open browser to http://localhost:3000
   
2. **Enter Participant Information**
   - Fill in participant details (ID, age, sex, race)
   - Select number of trials (5, 10, 25, 50, or 100)
   - Click "Start Session"

3. **Verify Hardware Connection**
   - Check that EEG status shows "Connected"
   - If disconnected, the system will attempt auto-reconnection

4. **Run the Experiment**
   - Click "Start Collection" when ready
   - Participant views color sequence:
     - 3-second countdown
     - 7 colors displayed for 5 seconds each
     - 2-second rest periods between colors
   - EEG data is recorded continuously

5. **Complete Session**
   - Data automatically saved after each trial
   - Download CSV file via "Download Data" button
   - Session summary displayed with trial count and duration

### Data Collection Protocol

Each trial consists of:
- **Countdown**: 3 seconds
- **Color Sequence**: 7 colors × (5s display + 2s rest) = 49 seconds
- **Total Trial Duration**: ~52 seconds

Colors presented in order:
1. RED (#FF0000)
2. BLUE (#0000FF)
3. GREEN (#00FF00)
4. PINK (#FF69B4)
5. YELLOW (#FFFF00)
6. ORANGE (#FFA500)
7. BLACK (#000000)

## 📊 Data Format

CSV files are saved to `data/sessions/` with the following structure:

```csv
timestamp,participant_id,age,sex,race,trial_number,color_id,color_name,event_type,relative_time_ms,ch1,ch2,...,ch16
2024-11-30T10:15:30.123Z,P001,25,Male,Asian,1,0,RED,color_start,0,12.5,13.2,...,11.8
2024-11-30T10:15:30.131Z,P001,25,Male,Asian,1,0,RED,eeg_sample,8,12.6,13.1,...,11.7
...
```

### Column Descriptions:
- **timestamp**: ISO 8601 timestamp
- **participant_id**: Unique participant identifier
- **age, sex, race**: Demographic information
- **trial_number**: Current trial (1-based)
- **color_id**: Color index (0-6)
- **color_name**: Color being displayed
- **event_type**: `color_start`, `color_end`, `rest_start`, `rest_end`, or `eeg_sample`
- **relative_time_ms**: Milliseconds since session start
- **ch1-ch16**: EEG channel values in microvolts

## 🔌 API Endpoints

### Health & Configuration
- `GET /api/health` - System health check
- `GET /api/config` - Get stimulus configuration
- `GET /api/eeg/status` - EEG hardware status

### Session Management
- `POST /api/session/start` - Initialize new session
- `GET /api/session/{session_id}` - Get session details
- `POST /api/session/{session_id}/end` - End session
- `GET /api/session/{session_id}/csv` - Download CSV data

### WebSocket Events
- `connect` - Client connection established
- `session:start` - Begin data collection
- `trial:complete` - Trial finished
- `eeg:sample` - Real-time EEG data (if enabled)

## 🐛 Troubleshooting

### OpenBCI Not Detected

1. **Verify physical connection**:
   - Check USB dongle is properly inserted
   - Ensure Cyton board is powered on (blue LED)
   - Confirm Daisy module is attached

2. **Check serial port permissions**:
   ```bash
   # Linux: Add user to dialout group
   sudo usermod -a -G dialout $USER
   
   # macOS: Check port accessibility
   ls -l /dev/cu.usbserial-*
   ```

### Data Not Recording

1. Check backend logs for errors in the terminal running `python main.py`

2. Verify data directory permissions:
   ```bash
   ls -la data/sessions/
   ```

3. Ensure sufficient disk space

4. Check backend/data/sessions/ (It'll probaly be there)

### Connection Issues

1. **Serial port busy**:
   - Close any other programs using the port (OpenBCI GUI, etc.)
   - Restart Docker containers

2. **BrainFlow errors**:
   - Update BrainFlow: `pip install --upgrade brainflow`
   - Check board firmware version

3. **WebSocket disconnections**:
   - Check network settings
   - Verify firewall allows ports 3000 and 8000


## 📝 Development

### Validating Session Data

After collecting EEG data, you can validate session integrity using the parser script:

```bash
# Validate a single session
python3 scripts/parse_session.py backend/data/sessions/session_YYYYMMDD_HHMMSS_name.csv

# Validate all sessions in a directory
python3 scripts/parse_session.py backend/data/sessions/
```

The script checks:
- **Sample rate**: Verifies actual vs expected 125 Hz
- **Data loss**: Calculates percentage of missing samples
- **Gap detection**: Finds intervals where samples were lost
- **Per-trial breakdown**: Shows capture rate for each trial
- **Channel health**: Validates all 16 EEG channels have data

Example output:
```
============================================================
EEG DATA INTEGRITY REPORT
============================================================
Session: 20251204_005053
Participant: Zach (Age: 20)

SAMPLE RATE ANALYSIS
--------------------
Expected rate: 125 Hz
Actual rate: 125.0 Hz
Actual samples: 10,979
Data loss: 0.0% [OK]

PER-TRIAL BREAKDOWN
-------------------
Trial 1: 6,157/6,150 samples (100.1%) [OK]
Trial 2: 3,392/6,151 samples (55.1%) [LOW]
```