@echo off
setlocal

rem ============================================================
rem  TRADCAL kiosk launcher
rem  Starts the Node server, then opens the board full-screen in
rem  Chrome kiosk mode. Double-click this file, or point a
rem  Windows Task Scheduler "Run at startup" task at it.
rem
rem  Requirements on this machine:
rem   - Google Chrome installed
rem   - .env already configured in this folder (see .env.example)
rem  Node.js is installed automatically (via winget) if it's missing.
rem ============================================================

rem Run from the folder this script lives in, regardless of how it's
rem launched (double-click, shortcut, Task Scheduler, etc.).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found on this computer. Attempting to install it...

    where winget >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] winget isn't available on this computer, so Node.js
        echo can't be installed automatically ^(winget ships with Windows 10
        echo 1809+ and Windows 11 — this machine may need a Windows update^).
        echo Install Node.js yourself from https://nodejs.org, then run this
        echo script again.
        pause
        exit /b 1
    )

    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo [ERROR] Node.js installation via winget failed. Install it
        echo manually from https://nodejs.org, then run this script again.
        pause
        exit /b 1
    )

    echo.
    echo Node.js is installed. This window's PATH won't see it until a new
    echo session starts, so please close this window and run the script
    echo again to continue.
    pause
    exit /b 0
)

if not exist "node_modules" (
    echo Installing dependencies, this only happens once...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. See the errors above.
        pause
        exit /b 1
    )
)

if not exist ".env" (
    echo [ERROR] No .env file found in this folder.
    echo Copy .env.example to .env and fill in your Azure/Graph settings first.
    pause
    exit /b 1
)

rem Start the server in its own window so this script can carry on to open
rem the browser once it's up. Closing that window stops the server.
start "TRADCAL Server" cmd /k npm start

rem Give the server a few seconds to finish starting before opening Chrome.
timeout /t 5 /nobreak >nul

rem --kiosk: full-screen, no browser chrome.
rem --noerrdialogs / --disable-infobars: hide crash-restore and other popups.
rem --autoplay-policy=no-user-gesture-required: lets the alarm/ping sounds
rem   play automatically — without this, Chrome blocks audio until someone
rem   clicks on the page once, which defeats the point of an alarm.
rem
rem If PORT is changed in .env, update the URL below to match.
start chrome --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required http://localhost:3000

endlocal
