# WiseCar EV Charger Simulator

A comprehensive Node.js WebSocket simulator that mimics a real WiseCar EV charger device, supporting both hotspot and Wi-Fi modes with proper mDNS service discovery.

## Features

- ✅ **WebSocket Server** - Real-time communication
- ✅ **mDNS Advertisement** - Discoverable as `wisecharger-mock.local`
- ✅ **Hotspot Mode** - Simulates first-time setup at `192.168.4.1`
- ✅ **Wi-Fi Mode** - Normal operation on LAN IP
- ✅ **Realistic Telemetry** - Voltage, current, energy, temperature
- ✅ **Command Handling** - Start/stop charging, set limits
- ✅ **Firestore Schema Compliance** - Matches real device data structure

## Quick Start

### 1. Installation

```bash
# Clone or download the project
cd wisecar-charger-simulator

# Install dependencies
npm install

# Start the simulator
npm start
```

### 2. Running Different Modes

**Wi-Fi Mode (Normal Operation):**
```bash
node server.js
# Runs on your LAN IP (e.g., 192.168.1.50:3000)
# Advertises via mDNS as wisecharger-mock.local
```

**Hotspot Mode (First-time Setup):**
```bash
node server.js --hotspot
# Simulates running on 192.168.4.1:3000
# No mDNS advertisement
```

## Protocol Documentation

### Connection Flow

1. **Client connects** to WebSocket server
2. **Server sends handshake** with device information
3. **Server starts telemetry** updates every 5 seconds
4. **Client can send commands** to control the device
5. **Server responds** with ACK/NACK messages

### Messages

#### 1. Handshake (Server → Client)

Sent immediately when client connects:

```json
{
  "event": "hello",
  "deviceId": "device_mock_001",
  "displayName": "Simulator Charger",
  "info": {
    "firmware": "v2.1.4",
    "model": "WiseCharger Pro AC22",
    "phases": 1,
    "rfidSupported": true,
    "serial": "WC-MOCK-123456"
  },
  "warranty": {
    "start": 1758827716,
    "end": 1821899716
  },
  "network": {
    "lastIp": "192.168.1.50",
    "mode": "wifi"
  },
  "settings": {
    "appNotifications": true,
    "autoPlug": true,
    "costPerKWh": 0,
    "deviceNotifications": false,
    "fastCharging": true,
    "language": "en",
    "limitA": 16
  }
}
```

#### 2. Telemetry Updates (Server → Client)

Sent every 5 seconds:

```json
{
  "event": "telemetry",
  "deviceId": "device_mock_001",
  "telemetry": {
    "status": "connected",
    "voltage": 232.4,
    "currentA": 0,
    "energyKWh": 0,
    "temperatureC": 34.2,
    "phases": 1,
    "updatedAt": 1758828000
  }
}
```

**Telemetry Values:**
- `status`: `"connected"` or `"charging"`
- `voltage`: 220-240V (realistic fluctuation)
- `currentA`: 0-16A (based on charging state and limit)
- `energyKWh`: Gradually increases during charging
- `temperatureC`: 30-50°C (higher when charging)

#### 3. Commands (Client → Server)

**Start Charging:**
```json
{ "action": "start" }
```
Response: `{ "ack": true, "msg": "Charging started" }`

**Stop Charging:**
```json
{ "action": "stop" }
```
Response: `{ "ack": true, "msg": "Charging stopped" }`

**Set Current Limit:**
```json
{ "action": "set_limitA", "value": 10 }
```
Response: `{ "ack": true, "msg": "Limit set to 10A" }`

**Reset Energy Counter:**
```json
{ "action": "reset_energy" }
```
Response: `{ "ack": true, "msg": "Energy counter reset" }`

## Testing

### Using WebSocket Client Tools

**wscat (Command Line):**
```bash
# Install wscat
npm install -g wscat

# Connect to simulator
wscat -c ws://192.168.1.50:3000

# Send commands
> {"action": "start"}
< {"ack":true,"msg":"Charging started"}

> {"action": "set_limitA", "value": 12}
< {"ack":true,"msg":"Limit set to 12A"}
```

**Browser JavaScript:**
```javascript
const ws = new WebSocket('ws://192.168.1.50:3000');

ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

ws.onopen = function() {
  // Start charging
  ws.send(JSON.stringify({ action: 'start' }));
};
```

### Using Postman

1. Create new **WebSocket** request
2. Connect to: `ws://192.168.1.50:3000` (or your LAN IP)
3. Send JSON commands in the message field
4. Observe telemetry updates every 5 seconds

### Flutter App Integration

The simulator advertises itself via mDNS, so Flutter apps can discover it:

```dart
// mDNS Discovery
final MDnsClient client = MDnsClient();
await client.startLookup(ResourceRecordQuery.serverPointer('_wisecar._tcp.local'));

// WebSocket Connection
final WebSocket socket = await WebSocket.connect('ws://wisecharger-mock.local:3000');

socket.listen((message) {
  final data = json.decode(message);
  print('Device message: $data');
});

// Send command
socket.add(json.encode({'action': 'start'}));
```

## Device Modes Explained

### Hotspot Mode (First-time Setup)

**Real Hardware Behavior:**
- Device creates Wi-Fi hotspot `WiseCharger_XXXXXX`
- Mobile app connects to hotspot network
- App communicates with device at `192.168.4.1`
- User configures Wi-Fi credentials
- Device reboots and connects to home network

**Simulator Behavior:**
```bash
node server.js --hotspot
```
- Runs WebSocket server on `192.168.4.1:3000`
- No mDNS advertisement (hotspot has no internet)
- Handshake shows `"mode": "hotspot"`

### Wi-Fi Mode (Normal Operation)

**Real Hardware Behavior:**
- Device connects to home/office Wi-Fi network
- Advertises mDNS service for easy discovery
- Mobile app finds device via mDNS or IP scan
- Continuous telemetry and remote control available

**Simulator Behavior:**
```bash
node server.js
```
- Runs on actual LAN IP (auto-detected)
- Advertises `wisecharger-mock.local` via mDNS
- Service type: `_wisecar._tcp.local`
- Handshake shows `"mode": "wifi"`

## Firestore Integration Guide

### Data Field Mapping

The simulator provides data that matches the Firestore schema:

**Manual Fields (Admin/App enters once):**
- `ownerUid` - Set when user claims device
- `displayName` - User-customizable name
- `createdAt` - Timestamp when added to Firestore
- `settings.costPerKWh` - Local electricity cost
- `warranty.start/end` - From purchase records

**Automatic Fields (From Device):**
- **Handshake data:** `deviceId`, `info.*`, `network.*`, `settings.limitA`, etc.
- **Telemetry data:** All `telemetry.*` fields updated every 5 seconds

### Example Firestore Write

```javascript
// When device connects and sends handshake
const deviceDoc = {
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  deviceId: handshake.deviceId,
  displayName: handshake.displayName,
  info: handshake.info,
  warranty: handshake.warranty,
  network: handshake.network,
  ownerUid: currentUser.uid, // From authentication
  settings: {
    ...handshake.settings,
    costPerKWh: 0.15 // User input or default
  }
};

// When telemetry arrives
const telemetryUpdate = {
  'telemetry': telemetryData.telemetry
};
```

## Console Output Example

```
🔌 WiseCar Charger Simulator Starting...
📡 Mode: Wi-Fi
🌐 WebSocket Server: ws://192.168.1.50:3000
📻 mDNS Service: wisecharger-mock.local:3000
📋 Service Type: _wisecar._tcp.local
✅ WiseCar Charger Simulator ready for connections!
💡 Usage:
   - Connect WebSocket client to receive telemetry
   - Send commands: {"action": "start"}, {"action": "stop"}, {"action": "set_limitA", "value": 10}
   - Press Ctrl+C to stop

🔗 New client connected from ::ffff:192.168.1.100
👋 Sent handshake to client
📨 Received: {"action": "start"}
📱 Command: Start charging
📊 Status: CHARGING | Clients: 1 | Energy: 0.42 kWh
📨 Received: {"action": "stop"}
📱 Command: Stop charging
🔌 Client disconnected from ::ffff:192.168.1.100
```

## Troubleshooting

**mDNS not working?**
- Ensure Bonjour/mDNS is enabled on your network
- Try connecting directly via IP: `ws://[IP]:3000`
- Windows users: Install Bonjour Print Services

**Can't connect to hotspot mode?**
- Simulator doesn't create actual hotspot
- Use `--hotspot` flag to simulate the IP behavior
- Test with manual IP connection

**Permission errors?**
- On macOS/Linux, port 3000 should work without sudo
- Try different port: modify `config.port` in server.js

## Development

### Project Structure
```
wisecar-charger-simulator/
├── package.json          # Dependencies and scripts
├── server.js            # Main WebSocket server
├── README.md           # This documentation
└── node_modules/       # Installed packages
```

### Extending the Simulator

**Add new commands:**
```javascript
case 'your_command':
  // Handle new command
  response = { ack: true, msg: 'Command executed' };
  break;
```

**Modify telemetry:**
```javascript
function generateTelemetry() {
  // Add new telemetry fields
  return {
    event: 'telemetry',
    deviceId: config.deviceId,
    telemetry: {
      // ... existing fields
      yourNewField: calculateYourValue()
    }
  };
}
```

## License

MIT License - Feel free to modify and use in your projects!