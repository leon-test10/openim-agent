@echo off
setlocal

set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-openim-pc.ps1"

if errorlevel 1 (
  echo.
  echo OpenIM PC startup failed. See the messages above.
  pause
  exit /b 1
)

