# WiseCar Protocol v2.1 - Command Reference

This document contains all the WebSocket commands and responses for the WiseCar charging device simulator following Protocol v2.1 specification.

## 📋 **Command Structure**

All commands follow this structure:
```json
{
  "type": "config|action|event",
  "command": "command_name",
  "userId": "user_identifier", 
  "data": { /* command specific data */ }
}
```

All responses follow this structure:
```json
{
  "type": "response",
  "command": "command_name",
  "success": true|false,
  "data": { /* success data */ },
  "error": "error message if failed",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

## 🔧 **CONFIG Commands**

### 1. Fast Charging Setting

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "fastCharging",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "value": true
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "fastCharging",
  "success": true,
  "data": {
    "value": true,
    "message": "Fast charging setting updated"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "fastCharging",
  "success": false,
  "error": "Invalid fastCharging value - boolean required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 2. Auto Plug Setting

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "autoPlug",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "value": false
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "autoPlug",
  "success": true,
  "data": {
    "value": false,
    "message": "Auto plug setting updated"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "autoPlug",
  "success": false,
  "error": "Invalid autoPlug value - boolean required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 3. Language Setting

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "language",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "value": "en"
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "language",
  "success": true,
  "data": {
    "value": "en",
    "message": "Language setting updated"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "language",
  "success": false,
  "error": "Invalid language value - string required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 4. Network Configuration

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "network",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "ssid": "نعمان چوھدری",
    "password": "maasdqygggg",
    "local": true
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "network",
  "success": true,
  "data": {
    "ssid": "نعمان چوھدری",
    "status": "configured",
    "message": "Network configuration saved"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "network",
  "success": false,
  "error": "Invalid network parameters",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 5. Add RFID

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "add_rfid",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "id": "RFID#123456",
    "userId": "user_789"
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "add_rfid",
  "success": true,
  "data": {
    "id": "RFID#123456",
    "message": "RFID added successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "add_rfid",
  "success": false,
  "error": "Invalid RFID data - id required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 6. Delete RFID

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "delete_rfid",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "id": "RFID#123456"
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "delete_rfid",
  "success": true,
  "data": {
    "id": "RFID#123456",
    "message": "RFID deleted successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "delete_rfid",
  "success": false,
  "error": "RFID ID required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 7. Set Limit Setting

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "set_limitA",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "value": 16
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "set_limitA",
  "success": true,
  "data": {
    "value": 16,
    "message": "Set limit setting updated"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "set_limitA",
  "success": false,
  "error": "Invalid set limit value",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 8. Set Device Time

**📤 App → Device:**
```json
{
  "type": "config",
  "command": "setTime",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "year": 2025,
    "month": 6,
    "day": 3,
    "hour": 11,
    "minute": 22,
    "second": 33
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "setTime",
  "success": true,
  "data": {
    "message": "Device time set successfully",
    "setTime": "2025-06-03 11:22:33"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "setTime",
  "success": false,
  "error": "Invalid time data - year, month, day, hour, minute, second required",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 9. Set Charging Time Limit

**📤 App → Device:**
```json
{
  "type": "config", 
  "command": "set_limitTime",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "value": 2
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "set_limitTime",
  "success": true,
  "data": {
    "value": 2,
    "message": "Charging time limit set successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "set_limitTime",
  "success": false,
  "error": "Invalid time limit (must be 1-24 hours)",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

## ⚡ **ACTION Commands**

### 1. Start Charging

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "start_charging",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "sessionType": "manual",
    "rfidId": "RFID#123456"
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "start_charging",
  "success": true,
  "data": {
    "sessionId": "session_000000001",
    "startTime": "2025-11-08T10:00:00.000Z",
    "message": "Charging started successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "start_charging",
  "success": false,
  "error": "Charging already in progress",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 2. Stop Charging

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "stop_charging",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "reason": "User requested stop"
  }
}
```

**📥 Device → App (Success):**
```json
{
  "type": "response",
  "command": "stop_charging",
  "success": true,
  "data": {
    "sessionId": "session_000000001",
    "endTime": "2025-11-08T10:30:00.000Z",
    "energyDelivered": 5.25,
    "message": "Charging stopped successfully"
  },
  "timestamp": "2025-11-08T10:30:00.000Z"
}
```

**📥 Device → App (Error):**
```json
{
  "type": "response",
  "command": "stop_charging",
  "success": false,
  "error": "No active charging session",
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 3. Ping (Heartbeat)

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "ping",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32"
}
```

**📥 Device → App:**
```json
{
  "type": "response",
  "command": "ping",
  "success": true,
  "data": {
    "message": "pong",
    "deviceStatus": "connected"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 4. Get Device Status

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "get_status",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32"
}
```

**📥 Device → App:**
```json
{
  "type": "response",
  "command": "get_status",
  "success": true,
  "data": {
    "status": "connected",
    "isCharging": false,
    "connectedClients": 1,
    "currentSession": null,
    "totalEnergy": 0.00,
    "uptime": "2h 15m"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 5. Sync RFIDs

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "sync_rfids",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "rfids": [
      {
        "id": "RFID#111111",
        "userId": "user_123"
      },
      {
        "id": "RFID#222222", 
        "userId": "user_456"
      }
    ]
  }
}
```

**📥 Device → App:**
```json
{
  "type": "response",
  "command": "sync_rfids",
  "success": true,
  "data": {
    "synced": 2,
    "total": 2,
    "message": "RFIDs synchronized successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 6. Get Unsynced Sessions

**📤 App → Device:**
```json
{
  "type": "action",
  "command": "get_unsynced_sessions",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32"
}
```

**📥 Device → App:**
```json
{
  "type": "response",
  "command": "get_unsynced_sessions",
  "success": true,
  "data": {
    "sessions": [
      {
        "sessionId": "session_000000001",
        "startAt": "2025-11-08T09:00:00.000Z",
        "endAt": "2025-11-08T09:30:00.000Z",
        "energykW": 5.25,
        "rfidId": "RFID#123456"
      }
    ],
    "count": 1
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

## 🎯 **EVENT Commands**

### 1. RFID Tap Event

**📤 App → Device:**
```json
{
  "type": "event",
  "command": "rfid_tap",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32",
  "data": {
    "id": "RFID#123456"
  }
}
```

**📥 Device → App:**
```json
{
  "type": "response",
  "command": "rfid_tap",
  "success": true,
  "data": {
    "id": "RFID#123456",
    "message": "Charging started with RFID",
    "sessionId": "session_000000002"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

## 📡 **Device-Initiated Events**

### 1. Hello/Handshake (Device → App)

**📥 Device → App (Connection Established):**
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
  },
  "rfids": [
    {
      "number": 1,
      "id": "RFID#111111",
      "userId": "user_123"
    }
  ],
  "network": {
    "mode": "hotspot",
    "ssid": "WiseCar-Device",
    "connected": true,
    "local": false
  },
  "status": {
    "charging": false,
    "connected": true,
    "error": null,
    "lastUpdate": "2025-11-08T10:00:00.000Z"
  }
}
```

---

### 2. Telemetry Stream (Device → App)

**📥 Device → App (Every 5 seconds):**
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
    "temperatureC": 25,
    "updatedAt": "2025-11-08T10:00:00.000Z"
  },
  "lastSession": null
}
```

**📥 Device → App (During Charging):**
```json
{
  "event": "telemetry",
  "deviceId": "wtl-202501234567", 
  "telemetry": {
    "status": "charging",
    "voltageV": 230,
    "currentA": 16.0,
    "powerkWh": 3.68,
    "phases": 1,
    "temperatureC": 28,
    "updatedAt": "2025-11-08T10:00:00.000Z"
  },
  "lastSession": {
    "sessionId": "session_000000001",
    "sessionStatus": "charging", 
    "sessionUserId": "user_123",
    "startAt": "2025-11-08T09:30:00.000Z",
    "endAt": null,
    "energykW": 2.45,
    "rfidId": "RFID#123456"
  }
}
```

---

### 3. Network Update Event (Device → App)

**📥 Device → App (After Network Config):**
```json
{
  "event": "network_updated",
  "deviceId": "wtl-202501234567",
  "message": "Network configuration updated. Connection maintained for testing.",
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
  },
  "rfids": [],
  "network": {
    "mode": "wifi",
    "ssid": "نعمان چوھدری",
    "connected": true,
    "local": true
  },
  "status": {
    "charging": false,
    "connected": true,
    "error": null,
    "lastUpdate": "2025-11-08T10:00:00.000Z"
  }
}
```

---

## 🎯 **Broadcast Events (Device → All Clients)**

### 1. RFID Tap Broadcast

**📥 Device → All Apps (When RFID is tapped):**
```json
{
  "type": "event",
  "event": "rfid_tap",
  "data": {
    "id": "RFID#123456",
    "success": true,
    "message": "Charging started with RFID",
    "sessionId": "session_000000002",
    "charging": true
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 2. Charging Start Broadcast

**📥 Device → All Apps (When charging begins automatically):**
```json
{
  "type": "event",
  "command": "start_charging",
  "success": true,
  "data": {
    "sessionId": "session_000000001",
    "startTime": "2025-11-08T10:00:00.000Z",
    "message": "Charging started successfully"
  },
  "timestamp": "2025-11-08T10:00:00.000Z"
}
```

---

### 3. Charging Stop Broadcast

**📥 Device → All Apps (When charging ends automatically):**
```json
{
  "type": "event",
  "command": "stop_charging",
  "success": true,
  "data": {
    "sessionId": "session_000000001",
    "endTime": "2025-11-08T10:30:00.000Z",
    "energyDelivered": 5.25,
    "message": "Charging stopped successfully"
  },
  "timestamp": "2025-11-08T10:30:00.000Z"
}
```

---

## 🔍 **Data Validation**

| Field Type | Validation Rules |
|------------|------------------|
| `userId` | Required string for all commands |
| `type` | Must be one of: `"config"`, `"action"`, `"event"` |
| `command` | Required string, case-sensitive |
| `data.value` (boolean) | Must be `true` or `false` for settings |
| `data.value` (string) | Non-empty string for language |
| `data.ssid` | Non-empty string for network config |
| `data.password` | Non-empty string for network config |
| `data.id` | Non-empty string for RFID operations |

---

## 📁 **Data Persistence**

- **Device Settings**: Saved to `device-config.json`
- **Network Config**: Saved to `network-config.json`  
- **RFIDs**: Saved to `rfids.json`
- **Sessions**: Saved to `sessions.json`

---

## 🚀 **Usage Examples**

### Complete Workflow: Configure Device Settings

1. **Connect to WebSocket** → Receive `hello` event
2. **Configure Fast Charging** → Send `fastCharging` config
3. **Configure Auto Plug** → Send `autoPlug` config  
4. **Set Language** → Send `language` config
5. **Configure Network** → Send `network` config
6. **Sync RFIDs** → Send `sync_rfids` action
7. **Monitor Telemetry** → Receive continuous `telemetry` events

### Charging Session Workflow

1. **RFID Tap** → Send `rfid_tap` event OR Send `start_charging` action
2. **Monitor Progress** → Receive `telemetry` events with session data
3. **Stop Charging** → Send `stop_charging` action OR Second RFID tap
4. **Get Session Data** → Send `get_unsynced_sessions` action

---

*Last Updated: November 8, 2025*  
*Protocol Version: v2.1*  
*Device Model: WTL-22KW Simulator*