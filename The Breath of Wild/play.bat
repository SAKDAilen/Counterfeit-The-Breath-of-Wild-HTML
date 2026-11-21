@echo off
setlocal
cd /d "%~dp0"

rem Start the Hyrule server in a minimized window, then open the game.
start "Hyrule Server" /min cmd /c "call start-server.bat"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/"

echo [botw] Game opened at http://127.0.0.1:8787/
echo [botw] Close the minimized "Hyrule Server" window to stop the backend.
timeout /t 4 /nobreak >nul
endlocal
