@echo off
setlocal
cd /d "%~dp0"

rem Prefer Node.js on PATH, then fall back to the bundled runtime.
where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_EXE=node"
) else (
    set "NODE_EXE=C:\Users\12858\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)

if /i "%NODE_EXE%"=="node" goto :run
if not exist "%NODE_EXE%" (
    echo [botw] Node.js 20+ was not found.
    echo [botw] Install Node.js, or update NODE_EXE in start-server.bat.
    pause
    exit /b 1
)

:run
if "%PORT%"=="" set "PORT=8787"
if "%HOST%"=="" set "HOST=127.0.0.1"
echo [botw] Hyrule server: http://%HOST%:%PORT%/
"%NODE_EXE%" "%~dp0server\index.js"
if errorlevel 1 (
    echo.
    echo [botw] The server stopped with an error. See the message above.
    pause
)
endlocal
