@echo off
rem Starts the job-apply dashboard and opens it in your browser.
cd /d "%~dp0"
python -m backend %*
