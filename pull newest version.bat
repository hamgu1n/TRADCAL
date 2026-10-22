@echo off
setlocal

rem ============================================================
rem  TRADCAL updater
rem  Pulls the newest version of the board from GitHub. Double-click
rem  this file, then restart the server (close the "TRADCAL Server"
rem  window and run start-kiosk.bat) so the changes take effect.
rem
rem  Requirements on this machine:
rem   - Git installed (https://git-scm.com)
rem ============================================================

rem Run from the folder this script lives in, regardless of how it's
rem launched (double-click, shortcut, etc.).
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git was not found on this computer. Install it from
    echo https://git-scm.com, then run this script again.
    pause
    exit /b 1
)

git pull
if errorlevel 1 (
    echo.
    echo [ERROR] git pull failed. See the errors above.
    pause
    exit /b 1
)

echo.
echo Up to date. Restart the server for the changes to take effect.
pause

endlocal
