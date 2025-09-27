# 🔌 WiseCar Charger Simulator - Complete Guide

## Overview
This simulator allows you to test the complete WiseCar EV charger functionality including RFID management, charging sessions, and real-time monitoring through a web dashboard.

---

## 🚀 Quick Start

### 1. Start the Simulator
```bash
node server-enhanced.js
```

**Expected Output:**
```
🔌 WiseCar Charger Simulator with RFID Support Starting...
📡 Mode: Wi-Fi
🌐 WebSocket Server: ws://192.168.0.105:3000
🌐 HTTP Server: http://192.168.0.105:3002
✅ WiseCar Charger Simulator with RFID ready for connections!

📋 RFID Status:
   ⚠️  No RFIDs loaded. Sync from Flutter app using:
      WebSocket: {"action": "sync_rfids", "rfids": [...]}
      HTTP: PUT http://localhost:3002/rfids/sync
```

### 2. Start the Dashboard
```bash
npm run dashboard
```
Then open: **http://localhost:8080**

### 3. Connect Flutter App
Connect your Flutter app to the WebSocket URL shown in the simulator output.

---

## 📱 Flutter App Integration

### Connection Flow
1. **Discover Device** - App discovers simulator via mDNS
2. **Connect WebSocket** - App connects to `ws://IP:3000`
3. **Sync RFIDs** - App sends RFIDs from Firestore to simulator
4. **Session Management** - Server tracks charging sessions even when app disconnected
5. **Real-time Updates** - Bi-directional communication for charging/RFID/session events

### RFID Synchronization
When your Flutter app connects, it should sync RFIDs:

**WebSocket Command:**
```json
{
  "action": "sync_rfids",
  "rfids": [
    {
      "rfidId": "RFID#123456",
      "label": "Dad Card",
      "ownerUid": "ABC12345",
      "ownerName": "Ali Ahmed",
      "createdAt": 1727410800
    },
    {
      "rfidId": "RFID#789012", 
      "label": "Mom Card",
      "ownerUid": "ABC12345",
      "ownerName": "Sara Ahmed",
      "createdAt": 1727411400
    }
  ]
}
```

**Server Response:**
```json
{
  "ack": true,
  "msg": "Synced 2 RFIDs successfully",
  "count": 2,
  "rfids": ["RFID#123456 (Dad Card)", "RFID#789012 (Mom Card)"]
}
```

---

## 🎮 Dashboard Usage

### Connection
1. Start the simulator (`node server-enhanced.js`)
2. Start dashboard (`npm run dashboard`)  
3. Open **http://localhost:8080**
4. Click **"Connect & Test"**
5. Dashboard shows **"Connected"** with live telemetry

### RFID Management
- **View RFIDs** - See all synced RFIDs from your Flutter app
- **Simulate Tap** - Click **"▶️ Tap"** button on any RFID to start charging
- **Stop Charging** - Click **"⏹️ Stop"** button on active RFID
- **Refresh List** - Click **"🔄 Refresh RFIDs"** to update from server
- **Clear All** - Click **"🗑️ Clear All"** to remove all RFIDs (for testing)

### Charging Controls
- **Manual Start/Stop** - Use control panel buttons
- **Set Current Limit** - Adjust charging amperage (6-16A)
- **Reset Energy** - Clear energy counter
- **RFID Control** - Start/stop via RFID simulation

---

## 🔌 Charging Operations

### Method 1: Manual Control (Dashboard/App)
```json
// Start charging
{"action": "start"}

// Stop charging  
{"action": "stop"}

// Set limit
{"action": "set_limitA", "value": 12}
```

### Method 2: RFID Control
```json
// Simulate RFID tap (toggles charging)
POST http://localhost:3002/simulate-rfid/RFID#123456
```

**Behavior:**
- **First tap** → Starts charging session
- **Second tap (same RFID)** → Stops session, returns energy used
- **Different RFID tap** → Stops current session, starts new one

### Real-time Events
**RFID Scan Started:**
```json
{
  "event": "rfid_scanned",
  "rfidId": "RFID#123456",
  "status": "started", 
  "timestamp": 1727414000
}
```

**RFID Scan Stopped:**
```json
{
  "event": "rfid_scanned",
  "rfidId": "RFID#123456",
  "status": "stopped",
  "energyKWh": 4.2,
  "timestamp": 1727416800
}
```

---

## � Session Management

The server now tracks detailed charging sessions with persistent data, even when your Flutter app disconnects.

### Session Features
- **Automatic Tracking** - Sessions start/stop with charging
- **Persistent Storage** - Data survives app disconnections 
- **Session Types** - RFID-initiated or manual sessions
- **Complete Records** - Duration, energy, timestamps, user info
- **Real-time Events** - Session start/stop notifications

### Session Data Structure
```json
{
  "sessionId": "session_1727414000_abc123def",
  "rfidId": "RFID#123456",           // null for manual sessions
  "startTime": 1727414000,           // Unix timestamp
  "endTime": 1727416800,             // null for active sessions  
  "startEnergyKWh": 0,
  "endEnergyKWh": 4.2,
  "durationSeconds": 2800,
  "status": "completed",             // "active" or "completed"
  "deviceId": "device_mock_001",
  "sessionType": "rfid"              // "rfid" or "manual"
}
```

### Real-time Session Events
**Session Started:**
```json
{
  "event": "session_started",
  "session": { /* session object */ },
  "timestamp": 1727414000
}
```

**Session Completed:**
```json
{
  "event": "session_completed", 
  "session": { /* completed session */ },
  "reason": "RFID tap stop",
  "timestamp": 1727416800
}
```

### Flutter App Integration
When your app reconnects after being offline:

1. **Get Active Session** - Check if charging is still in progress
2. **Sync Session History** - Retrieve sessions that occurred while offline
3. **Save to Firestore** - Store session data for user records

```dart
// Example: Get sessions after reconnection
void syncSessionsAfterReconnect() async {
  // Get any active session
  final activeSession = await getActiveSession();
  if (activeSession != null) {
    print("Charging in progress: ${activeSession.sessionId}");
  }
  
  // Get recent sessions (while app was offline)
  final sessions = await getSessionHistory(limit: 100);
  for (final session in sessions) {
    if (session.status == "completed") {
      // Save to Firestore if not already saved
      await saveSessionToFirestore(session);
    }
  }
}
```

---

## �🛠️ API Reference

### WebSocket Commands (Port 3000)

#### Device Control
```json
{"action": "start"}                          // Start charging
{"action": "stop"}                           // Stop charging  
{"action": "set_limitA", "value": 12}        // Set current limit
{"action": "reset_energy"}                   // Reset energy counter
```

#### RFID Management  
```json
{"action": "sync_rfids", "rfids": [...]}     // Bulk sync from Firestore
{"action": "add_rfid", "rfid": {...}}        // Add single RFID
{"action": "delete_rfid", "rfidId": "..."}   // Remove RFID
{"action": "list_rfids"}                     // Get all RFIDs
{"action": "tap_rfid", "rfidId": "..."}      // Simulate RFID tap
{"action": "get_status"}                     // Get device status
```

#### Session Management
```json
{"action": "get_sessions", "limit": 50}      // Get session history
{"action": "get_active_session"}             // Get current active session
```

### HTTP API (Port 3002)

#### RFID Operations
```bash
GET    /rfids                    # List all RFIDs
POST   /rfids                    # Add new RFID  
PUT    /rfids/sync               # Bulk sync RFIDs
DELETE /rfids/:rfidId            # Remove RFID
POST   /simulate-rfid/:rfidId    # Simulate RFID tap
```

#### Device Status
```bash
GET /status                      # Get device status (includes session info)
```

#### Session Management
```bash
GET  /sessions                   # Get session history
GET  /sessions/active            # Get active session  
POST /sessions/start             # Start manual session
POST /sessions/stop              # Stop active session
```

---

## 🔄 Complete Workflow Example

### 1. Flutter App Startup
```dart
// Connect to simulator
await connectToCharger('ws://192.168.0.105:3000');

// Fetch RFIDs from Firestore
final deviceDoc = await FirebaseFirestore.instance
    .collection('devices')  
    .doc(deviceId)
    .get();

final rfids = deviceDoc.data()?['rfids'] ?? [];

// Sync to simulator
await sendCommand({
  "action": "sync_rfids",
  "rfids": rfids
});
```

### 2. Dashboard Monitoring
1. Dashboard connects to simulator
2. Receives RFID list from handshake
3. Shows RFIDs in UI with tap buttons
4. Displays live telemetry every 5 seconds

### 3. RFID Charging Session
```bash
# User taps RFID card (simulated via dashboard)
curl -X POST http://localhost:3002/simulate-rfid/RFID#123456

# Simulator starts charging session
# Dashboard shows active RFID with charging indicator
# Flutter app receives rfid_scanned event

# User taps same card again
curl -X POST http://localhost:3002/simulate-rfid/RFID#123456

# Simulator stops session, returns energy used
# Dashboard updates, Flutter app receives stop event
```

### 4. Adding New RFID (from App)
```dart
// App adds to Firestore
await FirebaseFirestore.instance
    .collection('devices')
    .doc(deviceId) 
    .update({
  'rfids': FieldValue.arrayUnion([newRFID])
});

// App sends to simulator
await sendCommand({
  "action": "add_rfid",
  "rfid": newRFID
});

// Dashboard automatically updates RFID list
```

---

## 🚨 Troubleshooting

### Connection Issues
- **Dashboard shows "Disconnected"** → Check if `server-enhanced.js` is running
- **Flutter app can't connect** → Verify WebSocket URL and port 3000
- **No RFIDs showing** → App needs to sync RFIDs via `sync_rfids` command

### RFID Issues  
- **"RFID not registered"** → RFID not synced from app, use sync command
- **Tap doesn't work** → Check dashboard console for errors, verify server connection
- **Session not stopping** → Try manual stop or tap same RFID again

### Port Conflicts
- **WebSocket (3000)** → `netstat -ano | findstr :3000`
- **HTTP API (3002)** → `netstat -ano | findstr :3002`  
- **Dashboard (8080)** → `netstat -ano | findstr :8080`

---

## 📊 Monitoring & Logs

### Server Logs
- Connection events (client connect/disconnect)
- RFID operations (add/delete/sync)
- Charging sessions (start/stop via RFID or manual)
- WebSocket commands received and responses sent

### Dashboard Logs  
- Connection status
- Command responses
- RFID events
- Real-time activity log with timestamps

### Status Monitoring
```bash
# Check device status
curl http://localhost:3002/status

# Check RFID list
curl http://localhost:3002/rfids
```

---

## 💡 Development Tips

### Local Storage
Dashboard stores RFIDs in browser localStorage for persistence across page reloads.

### Real-time Sync
All RFID changes are immediately reflected in:
- Dashboard RFID list
- Server memory
- Connected Flutter apps (via events)

### Session Management
- Only one RFID can have an active session
- Tapping different RFID stops current session and starts new one
- Manual stop command clears active RFID session

### Error Handling
- Invalid RFID structure → Validation error
- Non-existent RFID tap → "RFID not registered" error  
- Connection loss → All UIs show disconnected state

---

## 🔧 Configuration

### Ports
- **WebSocket:** 3000 (auto-increment if busy)
- **HTTP API:** 3002 (auto-increment if busy)  
- **Dashboard:** 8080

### Environment Variables
```bash
PORT=3000          # WebSocket port
HTTP_PORT=3002     # HTTP API port
```

### Device Configuration
```javascript
// In server-enhanced.js
const config = {
  deviceId: 'device_mock_001',
  serviceName: '_wisecar._tcp.local'
};
```

This completes the WiseCar Charger Simulator setup. Your Flutter app can now connect, sync RFIDs, and control charging sessions while monitoring everything through the web dashboard!