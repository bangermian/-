@echo off
setlocal
cd /d "%~dp0"

set "PROFILE=%~dp0.chrome-auto"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME%" (
  echo   Chrome not found. Please install Chrome first.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo.
echo   Scraping window (background throttling disabled)
echo   =================================================
echo.
echo   This window uses its own profile: .chrome-auto
echo   Your normal Chrome profile is not touched.
echo.
echo   Why a special window:
echo     Chrome/Edge freeze background tabs to save power,
echo     which stops the collector. These flags turn that off.
echo.
echo   First time only:
echo     1) Open chrome://extensions in THIS window
echo     2) Turn on Developer mode, click Load unpacked
echo     3) Pick the folder:  %~dp0tools\extension
echo.
echo   Then keep this window open while scraping.
echo.
echo   NOTE: if a window with this profile is ALREADY open,
echo   close it first. Chrome reuses the running instance and
echo   the flags above would be ignored.
echo.

start "" "%CHROME%" ^
 --user-data-dir="%PROFILE%" ^
 --no-first-run ^
 --no-default-browser-check ^
 --disable-background-timer-throttling ^
 --disable-backgrounding-occluded-windows ^
 --disable-renderer-backgrounding ^
 --disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion,msEdgeSleepingTabs,msSleepingTabs ^
 --disable-hang-monitor ^
 "https://www.gaokao.cn/"

timeout /t 3 >nul
echo   Window opened. You can close this console.
timeout /t 5 >nul