#!/bin/bash
# Run both backend and frontend locally for macOS USB access

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting BCI Data Collection (Local Mode)${NC}"
echo ""

# Check for USB serial device
if ls /dev/cu.usbserial-* 1> /dev/null 2>&1; then
    echo -e "${GREEN}✓ EEG device detected:${NC} $(ls /dev/cu.usbserial-*)"
else
    echo -e "${YELLOW}⚠ No EEG device detected. The app will run but EEG features will be unavailable.${NC}"
fi
echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}Starting backend...${NC}"
cd backend
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt
python main.py &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start frontend
echo -e "${GREEN}Starting frontend...${NC}"
cd Frontend
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Services running:${NC}"
echo -e "  Backend:  http://localhost:8000"
echo -e "  Frontend: http://localhost:5173"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all services"

# Wait for processes
wait
