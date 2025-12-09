# Network Scan Testing

## How to Test

### 1. Start the server
```bash
node server-enhanced.js
```

### 2. Test from App
Connect your app to the device WebSocket, then send:

```json
{
  "type": "action",
  "command": "scan_network",
  "userId": "oky4MSvzXdg4bgOJWpV3nLlLct32"
}
```

### 3. Expected Response (Success)
```json
{
  "type": "response",
  "command": "scan_network",
  "success": true,
  "data": {
    "networks": [
      {
        "ssid": "YourNetwork1",
        "rssi": 4
      },
      {
        "ssid": "YourNetwork2",
        "rssi": 2
      }
    ],
    "count": 2
  },
  "timestamp": "2025-12-09T10:00:00.000Z"
}
```

### 4. Expected Response (No Networks)
```json
{
  "type": "response",
  "command": "scan_network",
  "success": false,
  "error": "no network",
  "timestamp": "2025-12-09T10:00:00.000Z"
}
```

### 5. Expected Response (Scan Failed)
```json
{
  "type": "response",
  "command": "scan_network",
  "success": false,
  "error": "scan failed",
  "timestamp": "2025-12-09T10:00:00.000Z"
}
```

## What It Does

- Scans for actual available WiFi networks on your Windows PC
- Converts signal strength from percentage (0-100%) to normalized scale (0-4)
  - 0-20% = 0 (very weak)
  - 21-40% = 1 (weak)
  - 41-60% = 2 (moderate)
  - 61-80% = 3 (good)
  - 81-100% = 4 (excellent)
- Removes duplicate networks
- Returns real network names (SSIDs) and signal strengths

## Console Output

When scanning, you'll see logs like:
```
📡 Command: Scan network - Starting WiFi scan...
✅ Found 5 networks:
   - MyHomeNetwork (signal: 4/4)
   - Neighbor_WiFi (signal: 2/4)
   - CoffeeShop_Guest (signal: 1/4)
   - Office_5GHz (signal: 3/4)
   - TP-Link_2.4G (signal: 2/4)
```

## Notes

- The scan uses Windows `netsh wlan show networks mode=Bssid` command
- Requires WiFi adapter to be enabled on the PC
- May take 2-3 seconds to complete the scan
- Only shows networks currently in range
