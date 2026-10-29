@echo off
setlocal
cd /d "%~dp0"

echo.
echo   gaokaoshun - local preview
echo   =========================
echo   URL  : http://127.0.0.1:8137/
echo   Root : %CD%
echo.
echo   Starting PowerShell static server...
echo   Press Ctrl+C to stop.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port 8137

echo.
echo Server stopped.
pause
