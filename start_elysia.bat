@echo off
title Elysia Launcher
cd /d "%~dp0"

echo ELYSIA - Windows Start Script
echo.

echo [1/2] Starting Python Agent on Port 8765...
if exist "venv\Scripts\python.exe" (
    start "Elysia Python Agent" cmd /k "venv\Scripts\python.exe scripts\run_agent.py"
) else (
    start "Elysia Python Agent" cmd /k "python scripts\run_agent.py"
)

timeout /t 2 /nobreak >nul

echo [2/2] Starting Node Server & Vite Frontend...
start "Elysia Node Server" cmd /k "npm run dev"

echo.
echo ==================================================
echo ELYSIA is running at: http://localhost:3000
echo Launching browser...
start http://localhost:3000
echo ==================================================
echo To stop, close the two command windows above.
echo.
