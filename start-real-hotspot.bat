@echo off
echo 🔌 WiseCar Simulator - Real Hotspot Mode
echo ========================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo ✅ Running as Administrator
) else (
    echo ❌ Not running as Administrator
    echo 💡 Right-click and "Run as Administrator" for hotspot creation
    echo 📝 Continuing in simulation mode...
)

echo.
echo 📡 Starting WiseCar Simulator with Real Hotspot...
echo.

REM Navigate to server directory
cd /d "%~dp0"

REM Start the Node.js server
node server-enhanced.js

pause