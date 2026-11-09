@echo off
cd /d "%~dp0"
node scripts/local-pilot.mjs start
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3100/"
