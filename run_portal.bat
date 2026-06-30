@echo off
title Medblaze AI Portal Orchestrator
cd /d "%~dp0"
echo Starting Medblaze AI Portal...
..\.venv\Scripts\python.exe run_portal.py
pause
