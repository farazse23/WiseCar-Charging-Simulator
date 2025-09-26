@echo off
title WiseCar Charger Simulator

echo ===============================================
echo 🔌 WiseCar EV Charger Simulator
echo ===============================================
echo.

:MENU
echo Choose an option:
echo.
echo 1. Start WiseCar Simulator Server
echo 2. Start Web Dashboard (http://localhost:8080)
echo 3. Run Test Client
echo 4. Open Test HTML Page
echo 5. Show All Options
echo 0. Exit
echo.

set /p choice="Enter your choice (0-5): "

if "%choice%"=="1" goto START_SERVER
if "%choice%"=="2" goto START_DASHBOARD
if "%choice%"=="3" goto RUN_TEST
if "%choice%"=="4" goto OPEN_HTML
if "%choice%"=="5" goto SHOW_INFO
if "%choice%"=="0" goto EXIT
goto INVALID

:START_SERVER
echo.
echo 📡 Starting WiseCar Charger Simulator...
echo Server will auto-find available port
echo Press Ctrl+C to stop the server
echo.
node server-simple.js
pause
goto MENU

:START_DASHBOARD
echo.
echo 🎛️ Starting Web Dashboard...
echo Open: http://localhost:8080
echo Press Ctrl+C to stop the dashboard
echo.
node dashboard-server.js
pause
goto MENU

:RUN_TEST
echo.
set /p server_url="Enter WebSocket URL (e.g., ws://localhost:3000): "
echo.
echo 🧪 Running Test Client...
node test-client.js %server_url%
pause
goto MENU

:OPEN_HTML
echo.
echo 🌐 Opening HTML Test Page...
start test.html
goto MENU

:SHOW_INFO
echo.
echo 📋 WiseCar Charger Simulator - Quick Reference
echo.
echo Available Scripts:
echo   npm start          - Start WiseCar simulator server
echo   npm run dashboard  - Start web dashboard
echo   npm test          - Run test client
echo.
echo WebSocket Endpoints:
echo   Simulator:     ws://localhost:3000 (or auto-assigned port)
echo.
echo Web Dashboard:   http://localhost:8080
echo.
echo Test Commands (send as JSON):
echo   {"action": "start"}                    - Start charging
echo   {"action": "stop"}                     - Stop charging
echo   {"action": "set_limitA", "value": 12}  - Set current limit
echo   {"action": "reset_energy"}             - Reset energy counter
echo.
pause
goto MENU

:INVALID
echo.
echo ❌ Invalid choice. Please enter 0-6.
echo.
pause
goto MENU

:EXIT
echo.
echo 👋 Thank you for using WiseCar Charger Simulator!
echo.
pause
exit