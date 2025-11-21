# WiseCar App Protocol - EXACT Implementation Guide

**Last Updated**: November 8, 2025  
**App Version**: 2.1.0  
**Protocol Version**: 2.0

This document reflects the EXACT commands and message formats used in the WiseCar app codebase.

--- 
## Overview
This document lists ALL commands used for communication between the WiseCar mobile app and charging devices via WebSocket connection.

*-> The device runs in AP (hotspot mode) at startup. The App must connect via 192.168.1.10:3000 websocket ip:port. This is fixed in running AP mode.* 
*-> To connect the device to a LAN, User should use network page in App. In this mode, IP will be changed. the App can connect to the device via mDNS.* 
*-> User can change SSID and password of the device in AP or STA mode.* 
*-> The App must send "userId" with commands.* 

### Current Limits
- **Range**: 8-32 Amperes
- **Type**: Integer

### Network Settings
- **SSID**: Max 32 characters
- **Password**: Max 32 characters
- **Local**: Boolean (true/false)

### Language Codes
- **English**: "en"
- **Turkish**: "tr"

### Boolean Settings
- **RFID Support**: true/false
- **Auto Plug**: true/false
- **Fast Charging**: true/false

### Command Structure
- All commands are JSON objects
- Use `action` for device control commands
- Use `command` for system-level commands
- Use `config` for configuration commands
- Include `timestamp` in ISO 8601 format when applicable

### Response Structure
- All responses include `ack` field (true/false)
- Success responses include `msg` field
- Error responses include `error` field
- Device events use `event` field to specify type

### Data Types
- Numbers: Integer or Float as appropriate
- Strings: UTF-8 encoded
- Booleans: true/false
- Timestamps: 
  - UNIX format: Integer seconds since epoch (e.g., `1699003200`)
  - ISO 8601 format: String (`YYYY-MM-DDTHH:mm:ss.sssZ`)
  - Session timestamps include both formats for compatibility
  - *There is no time difference data from UTC in the device. Device will send its time, so the app should convert time to UTC.* 
- Arrays: JSON arrays for lists (RFIDs, sessions, etc.)

### Dual Timestamp Storage
WiseCar sessions now store timestamps in both UNIX and ISO 8601 formats:

**UNIX Timestamps (seconds since epoch):**
- `startAt`: 1699003200
- `endAt`: 1699006800  
- `createdAt`: 1699003200
- `updatedAt`: 1699003200

**ISO 8601 Timestamps (human-readable):**
- `startAtISO`: "2025-11-06T12:00:00.000Z"
- `endAtISO`: "2025-11-06T13:00:00.000Z"
- `createdAtISO`: "2025-11-06T12:00:00.000Z"
- `updatedAtISO`: "2025-11-06T12:00:00.000Z"

### Usage Guidelines
- **UNIX timestamps**: Use for calculations, sorting, and database operations
- **ISO timestamps**: Use for display, logging, and API responses
- Both formats represent the same moment in time
- ISO format includes milliseconds and timezone (UTC)


---

## 1. Device Identification

### 1.1 Hello/Handshake (Device -> App)
*-> The device sends "hello" message when the app connected to it at startup (after websocket connection)*  
-> "deviceId" : model-serial
-> "display name" is also "model".(no need to write twice)
-> "serial": 12 numbers of length
-> "firmwareESP" : ESP32 microcontroller firmware 
-> "firmwareSTM": STM32 microcontroller firmware
-> "hardware": hardware version of board

**📥 Device → App:**
```json
{
  "event": "hello",
  "deviceId": "wtl-202501234567",
  "info": {
    "model": "WTL-22KW",
    "serial": "202501234567",
    "firmwareESP": "1.2.3",
    "firmwareSTM": "1.2.3",
    "hardware": "4.1"
  },
  "settings": {
    "rfidSupported": true,
    "autoPlug": true,
    "fastCharging": true,
    "language": "en",
    "limitA": 16
  },
  "warranty": {
    "start": "2025-10-30T12:34:56.789Z",
    "end": "2026-10-31T12:34:56.789Z"
  }
}
```

---

## 2. Telemetry

*-> The device sends telemetry message once per second.* 
*-> session Id is increased 1 per session by the device. In telemetry message last session is sent to the App. App must synchronise sessions according to the last session Id.* 
-> telemetry status :
  - "disconnected",
  - "connected",
  - "charging",
  - "charging need climate",
  - "charging completed with vehicle",
  - "charging completed with timer",
  - "charging completed with power",
  - "charging completed with remote",
  - "shortcut",
  - "critical error",
  - "noncritical error",
  - "fault"
-> "sessionId" : session+9 numbers (the device increased sessionId per session)
-> "sessionStatus": 
  - "started",
  - "completed", 
  - null
-> "sessionUserId": if user start charging, put userId, if not put null
-> "energykW" : transferred power in this session
-> "powerkWh": instantaneous power per hour
-> "rfidId": null (if no rfid started to charge)

### 2.1 Session Started
**📥 Device → App:**
```json
{
  "event": "telemetry",
  "deviceId": "wtl-202501234567",
  "telemetry": {
    "status": "charging",
    "voltageV": 230,
    "currentA": 12.45,
    "powerkWh": 22.00,
    "phases": 1,
    "temperatureC": 38,
    "updatedAt": "2025-11-01T12:34:56.789Z"
  },
  "lastSession": {
    "sessionId": "session_000000000",
    "sessionStatus": "started",
    "sessionUserId": "user_1234567",
    "startAt": "2023-11-03T18:00:00.000Z",
    "endAt": null,
    "energykW": 56.35,
    "rfidId": "123456789"
  }
}
```

### 2.2 Session Completed
**📥 Device → App:**
```json
{
  "event": "telemetry",
  "deviceId": "wtl-202501234567",
  "telemetry": {
    "status": "connected",
    "voltageV": 230,
    "currentA": 0.0,
    "powerkWh": 0.0,
    "phases": 1,
    "temperatureC": 38,
    "updatedAt": "2025-11-01T12:34:56.789Z"
  },
  "lastSession": {
    "sessionId": "session_000000000",
    "sessionStatus": "completed",
    "sessionUserId": "user_1234567",
    "startAt": "2023-11-03T18:00:00.000Z",
    "endAt": "2023-11-03T19:00:00.000Z",
    "energykW": 56.35,
    "rfidId": null
  }
}
```

---

## 3. Device Configurations

### 3.1 Network Configuration
**📤 App → Device:**
```json
{
  "config": "network",
  "userId": "user_1234567",
  "ssid": "WIFI_NETWORK_NAME",
  "password": "WIFI_PASSWORD",
  "local": false
}
```

### 3.2 Language Setting
-> **Supported values**: "en", "tr"

**📤 App → Device:**
```json
{
  "config": "language",
  "userId": "user_1234567",
  "value": "en"
}
```

### 3.3 RFID Support Control
**📤 App → Device:**
```json
{
  "config": "rfidSupported",
  "userId": "user_1234567",
  "value": true
}
```

### 3.4 Auto Plug Detection
**📤 App → Device:**
```json
{
  "config": "autoPlug",
  "userId": "user_1234567",
  "value": true
}
```

### 3.5 Fast Charging Mode
**📤 App → Device:**
```json
{
  "config": "fastCharging",
  "userId": "user_1234567",
  "value": true
}
```

### 3.6 Set Current Limit
**📤 App → Device:**
```json
{
  "config": "set_limitA",
  "userId": "user_1234567",
  "value": 16
}
```

### 3.7 Command Responses
*-> if command is applied successfully,* 

**📥 Device → App:**
```json
{
  "ack": true,
  "msg": "ok"
}
```

*-> if error is occured,* 

**📥 Device → App:**
```json
{
  "ack": false,
  "msg": "error",
  "error": "Error details"
}
```

---

## 4. Device Control Commands

### 4.1 Start Charging
*-> if "fastCharging" is true, current limit = max (limitA will be ignored)* 

**📤 App → Device:**
```json
{
  "action": "start",
  "userId": "user_1234567",
  "fastCharging": true, 
  "limitA": 16
}
```

### 4.2 Stop Charging
**📤 App → Device:**
```json
{
  "action": "stop",
  "userId": "user_1234567"
}
```

### 4.3 Set Current Limit
**📤 App → Device:**
```json
{
  "action": "set_limitA",
  "userId": "user_1234567",
  "value": 16
}
```

### 4.4 Command Responses
*-> if command is applied successfully,* 

**📥 Device → App:**
```json
{
  "ack": true,
  "msg": "ok"
}
```

*-> if command is not applied,* 

**📥 Device → App:**
```json
{
  "ack": false,
  "msg": "already charging"
}
```

*-> if error is occured,* 

**📥 Device → App:**
```json
{
  "ack": false,
  "msg": "error",
  "error": "Error details"
}
```

---

## 5. RFID Management Commands

### 5.1 Get RFID Number
*-> Get numbers of rfid saved in the device.* 

**📤 App → Device:**
```json
{
  "action": "rfid_numbers"
}
```

**📥 Device → App:**
```json
{
  "event": "rfid_numbers",
  "numbers": 5
}
```

### 5.2 Get RFID List

**📤 App → Device:**
```json
{
  "action": "rfid_list"
}
```

**📥 Device → App:**
```json
{
  "event": "rfid_list",
  "rfids": [
    {
      "number": 1,
      "id": "1001",
      "userId": "user123"
    },
    {
      "number": 2,
      "id": "1002",
      "userId": "user123"
    },
    {
      "number": 3,
      "id": "1003",
      "userId": "user123"
    }
  ]
}
```

*-> If there is not an rfid tag Id saved before,* 

**📥 Device → App:**
```json
{
  "event": "rfid_list",
  "rfids": []
}
```

### 5.3 Add RFID

**📤 App → Device:**
```json
{
  "action": "rfid_add",
  "rfids": [
    {
      "id": "1001",
      "userId": "user123"
    },
    {
      "id": "1002",
      "userId": "user123"
    },
    {
      "id": "1003",
      "userId": "user123"
    }
  ]
}
```

**📥 Device → App:**
```json
{
  "event": "rfid_add",
  "ok": true
}
```

### 5.4 Delete RFID

**📤 App → Device:**
```json
{
  "action": "rfid_delete",
  "rfids": [
    {
      "id": "1001"
    },
    {
      "id": "1002"
    },
    {
      "id": "1003"
    }
  ]
}
```

**📥 Device → App:**
```json
{
  "event": "rfid_delete",
  "ok": true
}
```

### 5.5 RFID Detection
*-> If the app send rfid detection message, the device will enter "RFID Detection Mode" and will send response whenever an rfid tag read in 30 seconds.* 
*-> If any rfid tag read, the device will leave from "RFID Detection Mode".* 

**📤 App → Device:**
```json
{
  "action": "rfid_detection"
}
```

**📥 Device → App:**
```json
{
  "event": "rfid_detection",
  "rfid": "123456789"
}
```

---

## 6. Session Management Commands

### 6.1 Get Last Session Id
*-> App may want the last session. The app must synchronise with itself.* 

**📤 App → Device:**
```json
{
  "action": "last_session",
  "userId": "user_1234567"
}
```

**📥 Device → App:**
```json
{
  "event": "last_session",
  "session": {
    "sessionId": "session_000000000",
    "sessionStatus": "completed",
    "sessionUserId": "user_1234567",
    "startAt": "2023-11-03T18:00:00.000Z",
    "endAt": "2023-11-03T19:00:00.000Z",
    "energykW": 56.35,
    "rfidId": "RFID-1001"
  }
}
```

*If there is no session ,* 

**📥 Device → App:**
```json
{
  "ack": false,
  "msg": "no session"
}
```

### 6.2 Get Session
*-> App may want the any session with Id. The app must synchronise with itself.* 

**📤 App → Device:**
```json
{
  "action": "get_session",
  "userId": "user_1234567",
  "sessionId": "session_000000000"
}
```

**📥 Device → App:**
```json
{
  "event": "get_session",
  "session": {
    "sessionId": "session_000000000",
    "sessionStatus": "completed",
    "sessionUserId": "user_1234567",
    "startAt": "2023-11-03T18:00:00.000Z",
    "endAt": "2023-11-03T19:00:00.000Z",
    "energykW": 56.35,
    "rfidId": "RFID-1001"
  }
}
```

*If there is no session with Id,* 

**📥 Device → App:**
```json
{
  "ack": false,
  "msg": "no session"
}
```

---

## 7. System Commands

### 7.1 Ping/Test Communication

**📤 App → Device:**
```json
{"command": "ping"}
```

**📥 Device → App:**
```json
{"command": "pong"}
```

---

## 🚨 CRITICAL DIFFERENCES FROM Protocol v2.1

### ❌ What WE Were Using (WRONG):
```json
{
  "type": "config",
  "command": "fastCharging",
  "data": { "value": true }
}
```

### ✅ What WiseCar App ACTUALLY Uses (CORRECT):
```json
{
  "config": "fastCharging",
  "userId": "user_1234567",
  "value": true
}
```

### 🔧 Key Changes Required:

1. **NO `type` field** - Use direct `config`, `action`, `command` fields
2. **NO `data` wrapper** - Put values directly in message
3. **Different response format** - Use `ack` + `msg` instead of `success` + `data`
4. **Different session field names** - Use `startAt` instead of `start`
5. **Fixed AP IP** - Use `192.168.1.10` not `192.168.1.19`
6. **Telemetry frequency** - Once per second, not every 5 seconds

---

*This document reflects the EXACT protocol expected by the WiseCar mobile application.*