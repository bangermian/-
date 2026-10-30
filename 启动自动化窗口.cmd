@echo off
setlocal
cd /d "%~dp0.."

set "PROFILE=%~dp0..\.chrome-auto"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME%" (
  echo   Chrome not found.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo.
echo   Opening a DEDICATED Chrome window for automation.
echo   It uses its own profile folder: .chrome-auto
echo   Your normal Chrome profile is NOT touched.
echo.
echo   Steps:
echo     1) Log in inside this window (SMS code / WeChat)
echo     2) Open  https://www.gaokao.cn/school/60/sturule
echo     3) Tell the assistant you are logged in
echo.
echo   Keep this window open. Close it to stop automation.
echo.

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "https://www.gaokao.cn/"

timeout /t 3 >nul
echo   Waiting for the window... you can close this console now.
timeout /t 8 >nul
