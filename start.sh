#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "[1/3] Killing old processes on ports 8000, 5173, 5174..."
npx kill-port 8000 5173 5174 2>/dev/null || true
sleep 1

echo "[2/3] Starting backend on http://localhost:8000 ..."
source "$ROOT/venv/Scripts/activate" 2>/dev/null || source "$ROOT/venv/bin/activate"
uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd "$ROOT"
sleep 2

echo "[3/3] Starting frontend on http://localhost:5173 ..."
cd "$ROOT/Frontend"
npm run dev &
FRONTEND_PID=$!
cd "$ROOT"

echo ""
echo "App running:"
echo "  Backend  ->  http://localhost:8000  (PID $BACKEND_PID)"
echo "  Frontend ->  http://localhost:5173  (PID $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to stop both servers."
wait
