# 🔌 Network Configuration - Quick Start

## What's New?

The WiseCar charger simulator now supports proper network configuration with two modes:
- **Hotspot Mode** 📡 - For first-time device setup
- **Wi-Fi Mode** 📶 - For normal operation after configuration

## For App Developers

### What You Need to Do

1. **Update your NetworkInfo model** to include:
   - `ssid` (String?)
   - `password` (String?)
   - Check if `mode` is "hotspot" or "wifi"

2. **Check the mode in handshake:**
   ```dart
   if (handshake.network.mode == "hotspot") {
     // Show Wi-Fi setup UI
   } else {
     // Device is ready, proceed normally
   }
   ```

3. **Send network configuration:**
   ```dart
   {
     "command": "network",
     "ssid": "MyWiFi",
     "password": "MyPassword",
     "local": false
   }
   ```

4. **Handle response:**
   ```dart
   {
     "command": "ack",
     "ssid": "MyWiFi",
     "status": "ok"  // or "error"
   }
   ```

### Complete Guide
👉 See [APP-DEVELOPER-GUIDE.md](APP-DEVELOPER-GUIDE.md) for detailed implementation

---

## For Manufacturers

### Device Requirements

1. **Support Two Modes:**
   - Start in hotspot mode if no Wi-Fi configured
   - Switch to Wi-Fi mode after receiving credentials

2. **Handshake Format:**
   ```json
   // Hotspot Mode
   {
     "network": {
       "mode": "hotspot",
       "ssid": null,
       "password": null
     }
   }
   
   // Wi-Fi Mode
   {
     "network": {
       "mode": "wifi",
       "ssid": "ConfiguredSSID",
       "password": "ConfiguredPassword"
     }
   }
   ```

3. **Accept Network Command:**
   ```json
   {
     "command": "network",
     "ssid": "NewSSID",
     "password": "NewPassword",
     "local": false
   }
   ```

4. **Persist Configuration:**
   - Save to non-volatile memory
   - Load on startup
   - Include in all handshakes

### Complete Specification
👉 See [DEVICE-PROTOCOL.json.md](DEVICE-PROTOCOL.json.md) for full protocol

---

## Testing

### Test Hotspot Mode
```bash
# Delete config file
rm network-config.json

# Start simulator
node server-enhanced.js

# Connect - device will be in hotspot mode
# Handshake will show: "mode": "hotspot", "ssid": null
```

### Test Wi-Fi Configuration
```json
// Send via WebSocket:
{
  "command": "network",
  "ssid": "TestWiFi",
  "password": "TestPass123",
  "local": false
}

// Expect response:
{
  "command": "ack",
  "ssid": "TestWiFi",
  "status": "ok"
}
```

### Test Persistence
```bash
# Restart simulator
node server-enhanced.js

# Device should remember configuration
# Handshake will show: "mode": "wifi", "ssid": "TestWiFi"
```

---

## Visual Flow

```
Device Starts
    ↓
No Config? → Hotspot Mode → App shows setup → User enters Wi-Fi
    ↓                            ↓
Has Config? → Wi-Fi Mode ←─── Device saves & switches mode
    ↓
Normal Operation
```

### Detailed Diagram
👉 See [NETWORK-FLOW-DIAGRAM.md](NETWORK-FLOW-DIAGRAM.md) for complete flows

---

## Documentation

📚 **Complete Documentation Index:** [DOCUMENTATION-INDEX.md](DOCUMENTATION-INDEX.md)

### Key Documents:
- [APP-DEVELOPER-GUIDE.md](APP-DEVELOPER-GUIDE.md) - App implementation guide
- [DEVICE-PROTOCOL.json.md](DEVICE-PROTOCOL.json.md) - Complete protocol spec
- [NETWORK-CONFIG-README.md](NETWORK-CONFIG-README.md) - Network mode details
- [NETWORK-FLOW-DIAGRAM.md](NETWORK-FLOW-DIAGRAM.md) - Visual flows
- [NETWORK-IMPLEMENTATION-SUMMARY.md](NETWORK-IMPLEMENTATION-SUMMARY.md) - Summary

---

## Quick Reference

### Hotspot Mode
- `mode: "hotspot"`
- `ssid: null`
- `password: null`
- **App Action:** Show Wi-Fi setup

### Wi-Fi Mode
- `mode: "wifi"`
- `ssid: "ConfiguredSSID"`
- `password: "ConfiguredPassword"`
- **App Action:** Skip setup, proceed

### Network Command
```json
{
  "command": "network",
  "ssid": "SSID",
  "password": "Password",
  "local": false
}
```

### Response
```json
{
  "command": "ack",
  "ssid": "SSID",
  "status": "ok" | "error"
}
```

---

## Status

✅ Implementation Complete  
✅ Documentation Complete  
✅ Tested and Working  
✅ Ready for Production  

---

**Need Help?**
- App Developers → [APP-DEVELOPER-GUIDE.md](APP-DEVELOPER-GUIDE.md)
- Manufacturers → [DEVICE-PROTOCOL.json.md](DEVICE-PROTOCOL.json.md)
- Testing → [NETWORK-CONFIG-README.md](NETWORK-CONFIG-README.md)
- Overview → [NETWORK-IMPLEMENTATION-SUMMARY.md](NETWORK-IMPLEMENTATION-SUMMARY.md)

**Last Updated:** November 1, 2025  
**Version:** 2.0
