@echo off
title Kill T2T App

echo Killing processes on ports 8000, 5173, 5174...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5174 " 2^>nul') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

echo Done. All T2T app processes killed.
timeout /t 2 /nobreak >nul
