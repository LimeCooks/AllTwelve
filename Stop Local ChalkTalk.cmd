@echo off
cd /d "%~dp0"
node scripts/local-pilot.mjs stop
if errorlevel 1 pause
