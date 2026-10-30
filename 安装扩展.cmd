@echo off
setlocal
cd /d "%~dp0"

set "EXTDIR=%~dp0tools\extension"

if not exist "%EXTDIR%\manifest.json" goto :nomanifest
if not exist "%EXTDIR%\collector.js" goto :nomanifest

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

echo.
echo   Gaokaoshun collector - extension install helper
echo   ==============================================
echo.
echo   This is a LOCAL extension: no store, no login, no network.
echo.
echo   In the Chrome page that opens:
echo     [1] turn on  Developer mode  (top right)
echo     [2] click  Load unpacked
echo     [3] select this folder:
echo         %EXTDIR%
echo.

if exist "%CHROME%" (
  start "" "%CHROME%" --new-window "chrome://extensions"
) else (
  echo   Chrome was not found in the usual locations.
  echo   Please open chrome://extensions manually.
)

start "" explorer "%EXTDIR%"

echo   The extension folder has been opened in Explorer.
echo   After loading it, refresh any page and the panel appears bottom-right.
echo.
pause
exit /b 0

:nomanifest
echo.
echo   ERROR: extension files are missing.
echo   Expected:
echo     %EXTDIR%\manifest.json
echo     %EXTDIR%\collector.js
echo.
echo   Make sure the whole project folder was copied, then run this again.
echo.
pause
exit /b 1
