@echo off
title T2T Data App

echo [1/3] Killing old processes on ports 8000, 5173, 5174...
call npx kill-port 8000 5173 5174 2>nul
timeout /t 1 /nobreak >nul

echo [2/3] Starting backend on http://localhost:8000 ...
start "T2T Backend" cmd /k "cd /d %~dp0backend && ..\venv\Scripts\activate && uvicorn main:socket_app --host 0.0.0.0 --port 8000 --reload"
timeout /t 2 /nobreak >nul

echo [3/3] Starting frontend on http://localhost:5173 ...
start "T2T Frontend" cmd /k "cd /d %~dp0Frontend && npm run dev"

echo.
echo App is starting up:
echo   Backend  -^>  http://localhost:8000
echo   Frontend -^>  http://localhost:5173
echo.
pause
