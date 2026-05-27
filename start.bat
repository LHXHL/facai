@echo off
chcp 65001 >nul
echo ========================================
echo Starting services...
echo ========================================

REM Start Mitmproxy
echo [1/3] Starting Mitmproxy...
start /b python mitmproxy_service.py

REM Wait 3 seconds for Mitmproxy
timeout /t 3 /nobreak >nul

REM Start Service Manager
echo [2/3] Starting Service Manager (Chrome)...
start /b python service_manager.py

REM Wait 5 seconds for Service Manager
timeout /t 5 /nobreak >nul

REM Start Flask
echo [3/3] Starting Flask...
start /b python app.py

echo ========================================
echo Services started!
echo - Mitmproxy: Port 18081
echo - Chrome Monitor: Auto check every 10s
echo - Flask Web: Port 5001
echo ========================================
echo Press any key to stop all services...
pause >nul

REM Stop all services
echo Stopping services...
taskkill /f /im python.exe >nul 2>&1

REM Kill Chrome by PID file (only kill the Chrome we started)
if exist chrome_headless.pid (
    for /f "tokens=*" %%p in (chrome_headless.pid) do taskkill /f /t /pid %%p >nul 2>&1
    del chrome_headless.pid >nul 2>&1
)

echo Services stopped.
