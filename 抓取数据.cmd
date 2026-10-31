@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\menu.ps1"

endlocal