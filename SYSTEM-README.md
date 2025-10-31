# WiseCar EV Charger Simulator – System Overview

This document explains the full simulator system, including discovery, WebSocket protocol, RFID management, offline charging behavior, and the new persistence + sync features for RFIDs and sessions.

## 1) Components

- Device Simulator (Node):
  - `server-enhanced.js` – WebSocket server + HTTP API, mDNS advertisement, RFID and session logic, persistence
  - `rfids.json` – persisted RFID list
  - `sessions.json` – persisted charging sessions (including offline sessions)
- Web Dashboard (HTML):
  - `dashboard.html` – Connects to device, shows telemetry, RFIDs, and session logs (now includes owner/tag info)
- Test tooling:
  - HTTP endpoints (simulate RFID tap, list/sync RFIDs, sessions)
  - WebSocket commands for control and sync

## 2) Device lifecycle at a glance

1. Device boots
2. Loads `rfids.json` and `sessions.json` from disk (if present)
3. Starts WebSocket server (auto-finds port), HTTP API, and advertises via mDNS
4. Waits for app/WebSocket clients
5. Emits telemetry every 5 seconds; handles commands (start/stop/set_limitA)
6. Manages charging sessions (manual or RFID)

## 3) Discovery

- mDNS: Published as `_wisecar._tcp.local` with device metadata
- App discovery (recommended order): quick scan → mDNS (8s) → network scan

## 4) WebSocket Protocol (JSON)

- Handshake (device → app) `event: "hello"` contains:
  - `deviceId`, `displayName`, `info`, `warranty`, `network`, `settings`, `rfids`
- Telemetry (device → app) `event: "telemetry"`:
  - `status`, `voltage`, `currentA`, `energyKWh`, `temperatureC`, `phases`, `updatedAt`, `currentRFID`, `activeSession`
- Commands (app → device):
  - Start/Stop: `{ "action": "start" }`, `{ "action": "stop" }`
  - Current limit: `{ "action": "set_limitA", "value": 6..16 }`
  - Energy reset: `{ "action": "reset_energy" }`
  - RFID mgmt: `{ "action": "sync_rfids" }`, `{ "action": "add_rfid" }`, `{ "action": "delete_rfid" }`, `{ "action": "list_rfids" }`
  - Sessions: `{ "action": "get_sessions" }`, `{ "action": "get_active_session" }`
  - Offline sync: `{ "action": "get_unsynced_sessions" }`, `{ "action": "ack_sessions_synced", "sessionIds": [...] }`
- Session events (device → app):
  - `session_started`, `session_completed` (include `rfidId`, `ownerUid`, `ownerName`, `label` when available)

## 5) HTTP API (for testing/tools)

- RFIDs
  - GET `/rfids` – list
  - POST `/rfids` – add one `{ rfidId, label, ownerUid, ownerName, createdAt? }`
  - PUT `/rfids/sync` – bulk sync `{ rfids: [...] }`
  - DELETE `/rfids/:rfidId` – remove
- RFID Simulation
  - POST `/simulate-rfid/:rfidId` – toggle charging by tag
- Sessions
  - GET `/sessions` – history (query `?limit=`)
  - GET `/sessions/unsynced` – sessions not yet cloud-acknowledged
  - POST `/sessions/ack` – body `{ sessionIds: ["session_..."] }`
- Status
  - GET `/status` – device + active session + counts

## 6) RFID data model (device ⇄ app)

- RFID object stored and exchanged:
  - `rfidId: string`
  - `label: string`
  - `ownerUid: string` (user id to attribute sessions)
  - `ownerName: string`
  - `createdAt: number` (Unix seconds)

## 7) Sessions data model (device → app)

- Session object fields:
  - `sessionId`, `sessionType` ("rfid"|"manual"), `deviceId`
  - `rfidId`, `ownerUid`, `ownerName`, `label`
  - `startTime`, `endTime`, `durationSeconds`
  - `startEnergyKWh`, `endEnergyKWh`
  - `status` ("active"|"completed")
  - `unsynced` (boolean; true until app acknowledges)

## 8) Offline RFID charging: how it works

- RFIDs synced at least once are persisted to `rfids.json`.
- If the app is offline, the device still accepts RFID taps:
  - First tap on authorized RFID → starts session; sets `isCharging`, `currentRFID`
  - Second tap (same RFID) → completes session
- Each session is appended to `sessions.json` with `unsynced: true`.
- On next app connection, the app fetches unsynced sessions, saves to cloud, then ACKs so the device marks them as synced.

## 9) App integration flow (reference)

1. Discover and connect to WebSocket (10s timeout). Expect `hello`.
2. Immediately sync RFIDs from Firestore:
```
{"action":"sync_rfids","rfids":[
  {"rfidId":"RFID#111111","label":"Owner Card","ownerUid":"USER_ABC","ownerName":"Alice","createdAt":1760000000},
  {"rfidId":"RFID#222222","label":"Spare","ownerUid":"USER_ABC","ownerName":"Bob"}
]}
```
3. Pull unsynced sessions:
```
{"action":"get_unsynced_sessions"}
```
4. Persist each session to Firestore using stable `sessionId` (idempotent). Attribute by `ownerUid` (e.g., `users/{ownerUid}/sessions/{sessionId}` and/or `devices/{deviceId}/sessions/{sessionId}`).
5. Acknowledge after successful writes:
```
{"action":"ack_sessions_synced","sessionIds":["session_..."]}
```
6. Subscribe to `telemetry`, `session_started`, `session_completed` for live UI.

## 10) Dashboard behavior (what you’ll see)

- Shows live telemetry and connection state
- RFID list with Owner and Label
- Session logs include `Owner` and `Tag` on start/stop

## 11) Files persisted on the device

- `rfids.json` – updated when RFIDs are added/deleted/synced; loaded at startup
- `sessions.json` – updated on session start/stop; contains `unsynced` flag for cloud sync

## 12) Quick test commands

Start the enhanced server:
```
node server-enhanced.js
```

Bulk sync RFIDs (HTTP):
```
curl -X PUT http://localhost:3002/rfids/sync \
  -H "Content-Type: application/json" \
  -d '{"rfids":[
    {"rfidId":"RFID#111111","label":"Owner Card","ownerUid":"USER123","ownerName":"Alice"},
    {"rfidId":"RFID#222222","label":"Guest","ownerUid":"USER123","ownerName":"Bob"}
  ]}'
```

Simulate RFID tap (start/stop):
```
curl -X POST http://localhost:3002/simulate-rfid/RFID#111111
curl -X POST http://localhost:3002/simulate-rfid/RFID#111111
```

Get unsynced sessions and ACK (HTTP):
```
curl http://localhost:3002/sessions/unsynced
curl -X POST http://localhost:3002/sessions/ack -H "Content-Type: application/json" -d '{"sessionIds":["session_..."]}'
```

## 13) Notes and best practices

- Always send full `sync_rfids` on connect for a single source of truth
- Use `sessionId` as Firestore document ID to guarantee idempotency
- Treat timestamps as Unix seconds
- If `ownerUid` is missing, store session under an "unassigned" collection for manual reconciliation
- Consider retries and exponential backoff for the sync pipeline

---

This simulator mirrors a production device’s behavior for discovery, control, RFID authorization, offline operation, and session attribution. The persistence and sync features ensure sessions started offline are reliably uploaded when the app reconnects.


