# WiseCar Charger Simulator - RFID Support

## Overview

The enhanced WiseCar Charger Simulator now includes full RFID support that matches the Flutter app's Firestore structure. This allows you to test RFID-based charging sessions, user management, and access control.

## RFID Storage Architecture

### Firestore Structure (App Side)
```javascript
// Document: devices/{deviceId}
{
  "deviceId": "device_1758827731717",
  "displayName": "Rapid Rise Tech",
  "rfids": [
    {
      "rfidId": "RFID#123456",
      "label": "Dad",
      "ownerUid": "ABC12345", 
      "ownerName": "Ali",
      "createdAt": 1758890000
    },
    {
      "rfidId": "RFID#789012",
      "label": "Mom", 
      "ownerUid": "ABC12345",
      "ownerName": "Sara",
      "createdAt": 1758890500
    }
  ],
  "info": { ... },
  "settings": { ... }
}
```

### Server Structure (In-Memory)
The simulator maintains an in-memory `rfids[]` array that mirrors the Firestore structure:
```javascript
let rfids = [
  {
    rfidId: "RFID#111111",
    label: "Test Tag", 
    ownerUid: "XYZ123",
    ownerName: "Admin",
    createdAt: 1758891000
  }
];
```

## RFID Management Workflow

### App → Server Synchronization
The server starts with **empty RFIDs**. The Flutter app must sync RFIDs from Firestore:

1. **Initial Sync**: When app connects → sends `sync_rfids` with all Firestore RFIDs
2. **Add RFID**: App adds to Firestore → sends `add_rfid` command to server  
3. **Delete RFID**: App removes from Firestore → sends `delete_rfid` command to server
4. **Bulk Sync**: Periodically sync entire RFID list to ensure consistency
5. **Scan RFID**: Device sends `rfid_scanned` event when card is tapped

### Server RFID Operations

#### 1. Add RFID
**WebSocket Command:**
```json
{
  "action": "add_rfid",
  "rfid": {
    "rfidId": "RFID#123456",
    "label": "Dad",
    "ownerUid": "ABC12345", 
    "ownerName": "Ali",
    "createdAt": 1758890000
  }
}
```

**Server Response:**
```json
{
  "ack": true,
  "msg": "RFID added successfully",
  "rfidId": "RFID#123456"
}
```

#### 2. Delete RFID
**WebSocket Command:**
```json
{
  "action": "delete_rfid",
  "rfidId": "RFID#123456"
}
```

**Server Response:**
```json
{
  "ack": true, 
  "msg": "RFID deleted successfully",
  "rfidId": "RFID#123456"
}
```

#### 3. List All RFIDs
**WebSocket Command:**
```json
{
  "action": "list_rfids"
}
```

**Server Response:**
```json
{
  "event": "rfid_list",
  "rfids": [
    {
      "rfidId": "RFID#111111",
      "label": "Test Tag",
      "ownerUid": "XYZ123", 
      "ownerName": "Admin",
      "createdAt": 1758891000
    }
  ],
  "timestamp": 1758891500
}
```

#### 4. Bulk Sync RFIDs (from Firestore)
**WebSocket Command:**
```json
{
  "action": "sync_rfids",
  "rfids": [
    {
      "rfidId": "RFID#123456",
      "label": "Dad Card",
      "ownerUid": "ABC12345",
      "ownerName": "Ali", 
      "createdAt": 1758890000
    },
    {
      "rfidId": "RFID#789012", 
      "label": "Mom Card",
      "ownerUid": "ABC12345",
      "ownerName": "Sara",
      "createdAt": 1758890500
    }
  ]
}
```

**Server Response:**
```json
{
  "ack": true,
  "msg": "Synced 2 RFIDs successfully",
  "count": 2
}
```

## RFID Scanning & Charging Sessions

### Simulating RFID Taps

**HTTP Endpoint:**
```bash
POST http://localhost:3002/simulate-rfid/RFID#111111
```

**Behavior:**
- **First tap** → Starts charging session
- **Second tap (same RFID)** → Stops session and returns energy used
- **Different RFID tap** → Stops current session and starts new one

### RFID Scan Events

**Start Charging:**
```json
{
  "event": "rfid_scanned",
  "rfidId": "RFID#123456", 
  "status": "started",
  "timestamp": 1758891600
}
```

**Stop Charging:**
```json
{
  "event": "rfid_scanned",
  "rfidId": "RFID#123456",
  "status": "stopped", 
  "energyKWh": 4.2,
  "timestamp": 1758893400
}
```

## Enhanced Handshake

The initial handshake now includes all registered RFIDs:

```json
{
  "event": "hello",
  "deviceId": "device_mock_001",
  "displayName": "Simulator Charger",
  "info": {
    "firmware": "v2.1.4",
    "model": "WiseCharger Pro AC22", 
    "rfidSupported": true,
    "serial": "WC-MOCK-123456"
  },
  "settings": { ... },
  "rfids": [
    {
      "rfidId": "RFID#111111",
      "label": "Test Tag",
      "ownerUid": "XYZ123",
      "ownerName": "Admin", 
      "createdAt": 1758891000
    }
  ]
}
```

## HTTP API Endpoints

### RFID Management
- `GET /rfids` - List all RFIDs
- `POST /rfids` - Add new RFID
- `PUT /rfids/sync` - Bulk sync RFIDs from Firestore
- `DELETE /rfids/:rfidId` - Remove RFID

### RFID Simulation  
- `POST /simulate-rfid/:rfidId` - Simulate RFID tap

### Device Status
- `GET /status` - Get current device status including active RFID

## Testing RFID Functionality

### 1. Start the Enhanced Server
```bash
node server-enhanced.js
```

### 2. List Pre-loaded RFIDs
```bash
curl http://localhost:3002/rfids
```

### 3. Add a New RFID
```bash
curl -X POST http://localhost:3002/rfids \
  -H "Content-Type: application/json" \
  -d '{
    "rfidId": "RFID#333333",
    "label": "New Card", 
    "ownerUid": "USER456",
    "ownerName": "John Doe"
  }'
```

### 4. Simulate RFID Tap (Start Charging)
```bash
curl -X POST http://localhost:3002/simulate-rfid/RFID#111111
```

### 5. Simulate Second Tap (Stop Charging)
```bash
curl -X POST http://localhost:3002/simulate-rfid/RFID#111111
```

### 6. Check Device Status
```bash
curl http://localhost:3002/status
```

## Real vs Simulated RFID

### Simulation (Testing)
- Uses HTTP endpoints to trigger RFID events
- `/simulate-rfid/:id` replaces physical card tap
- Perfect for app development and testing

### Real Hardware Implementation
- Replace HTTP simulation with actual NFC reader
- NFC reader detects RFID UID and triggers same `simulateRFIDScan()` function
- Same WebSocket events sent to connected clients
- No changes needed in app logic

## Integration with Flutter App

### 1. Device Discovery
App discovers simulator via mDNS with `rfidSupported: true` flag

### 2. Initial Connection & RFID Sync
When app connects to charger:
```dart
// 1. Connect WebSocket
await connectToCharger(wsUrl);

// 2. Fetch RFIDs from Firestore
final firestoreRFIDs = await getDeviceRFIDs(deviceId);

// 3. Sync to charger
await syncRFIDsToCharger(firestoreRFIDs);
```

**WebSocket Sync Command:**
```json
{
  "action": "sync_rfids",
  "rfids": [
    // All RFIDs from Firestore devices/{deviceId}.rfids
  ]
}
```

### 3. RFID Management Operations
```dart
// Add RFID: Update Firestore + Send to Charger
await addRFIDToFirestore(deviceId, rfidData);
await sendCommand({"action": "add_rfid", "rfid": rfidData});

// Delete RFID: Remove from Firestore + Send to Charger  
await deleteRFIDFromFirestore(deviceId, rfidId);
await sendCommand({"action": "delete_rfid", "rfidId": rfidId});
```

### 4. Real-time Events
App listens for `rfid_scanned` events to update UI and track sessions

### 5. Periodic Sync (Optional)
Periodically sync to handle edge cases:
```dart
Timer.periodic(Duration(minutes: 5), (_) {
  syncRFIDsToCharger(await getDeviceRFIDs(deviceId));
});
```

## Security Considerations

- RFID operations require proper authentication in production
- Server validates RFID data structure before adding
- Active sessions are properly terminated when RFIDs are deleted
- All RFID operations are logged for audit trails