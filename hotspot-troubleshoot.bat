@echo off
title WiseCar Simulator - Hotspot Troubleshoot
color 0A

echo ===============================================
echo 🔧 WiseCar Simulator - Hotspot Troubleshoot
echo ===============================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo ✅ Running as Administrator
    goto :checkhotspot
) else (
    echo ❌ NOT running as Administrator
    echo.
    echo 💡 SOLUTION: Right-click this file and select "Run as Administrator"
    echo.
    pause
    exit /b 1
)

:checkhotspot
echo 🔍 Checking Windows Hotspot Capability...
echo.

netsh wlan show drivers | findstr "Hosted network supported" > temp_hotspot.txt
if %errorlevel% == 0 (
    type temp_hotspot.txt
    findstr /i "yes" temp_hotspot.txt > nul
    if %errorlevel% == 0 (
        echo ✅ Hotspot supported - Good to go!
        goto :createhotspot
    ) else (
        echo ❌ Hosted network NOT supported on this WiFi adapter
        echo 💡 Your adapter doesn't support creating hotspots via netsh
        goto :alternatives
    )
) else (
    echo ❌ Could not check hotspot capability
    goto :alternatives
)

:createhotspot
echo.
echo 🔧 Attempting to create hotspot manually...
echo.

REM Stop any existing hotspot
netsh wlan stop hostednetwork > nul 2>&1

REM Configure hotspot
echo 📡 Configuring hotspot: WiseCar-234567
netsh wlan set hostednetwork mode=allow ssid="WiseCar-234567" key="wisecar123"

if %errorlevel__ == 0 (
    echo ✅ Hotspot configured successfully
    
    REM Start hotspot
    echo 🚀 Starting hotspot...
    netsh wlan start hostednetwork
    
    if %errorlevel__ == 0 (
        echo ✅ Hotspot started successfully!
        echo.
        echo 📡 SSID: WiseCar-234567
        echo 🔑 Password: wisecar123
        echo 🌐 IP: 192.168.137.1
        echo.
        echo 🚀 Now start the simulator:
        echo    node server-enhanced.js
        goto :success
    ) else (
        echo ❌ Failed to start hotspot
        goto :alternatives
    )
) else (
    echo ❌ Failed to configure hotspot
    goto :alternatives
)

:alternatives
echo.
echo 🔄 ALTERNATIVE SOLUTIONS:
echo.
echo 📋 Option 1: Manual Windows Hotspot
echo    1. Windows Settings ^> Network ^& Internet ^> Mobile hotspot
echo    2. Turn ON Mobile hotspot
echo    3. Set name: WiseCar-234567
echo    4. Set password: wisecar123
echo    5. IMPORTANT: You may need to disconnect from WiFi first!
echo    6. Start simulator: node server-enhanced.js
echo.
echo 📋 Option 2: Same Network Mode
echo    1. Connect both PC and phone to same WiFi
echo    2. Start simulator: node server-enhanced.js
echo    3. Phone connects to: ws://192.168.1.10:3000
echo.
goto :end

:success
echo.
echo ✅ SUCCESS! Hotspot is ready.
echo 📱 Connect your phone to "WiseCar-234567" network
echo 🚀 Then start: node server-enhanced.js
echo.

:end
if exist temp_hotspot.txt del temp_hotspot.txt
echo.
echo Press any key to exit...
pause > nul