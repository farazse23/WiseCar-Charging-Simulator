const WebSocket = require('ws');
const express = require('express');
const bonjour = require('bonjour')();
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const config = {
  port: process.env.PORT || 3000,
  httpPort: process.env.HTTP_PORT || 3002,
  deviceId: 'wtl-302501234567', // Use your actual device format
  serviceName: '_wisecar._tcp.local',
  devMode: process.env.DEV_MODE === 'true' || process.argv.includes('--dev') // Development mode flag
};

// Server startup time for uptime calculation
const serverStartTime = new Date();

// Helper function to calculate uptime with seconds
function getUptime() {
  const now = new Date();
  const uptimeMs = now - serverStartTime;
  
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours}h ${minutes}m ${seconds}s`;
}

// Device info structure matching new protocol
const deviceInfo = {
  model: "WTP3 S400",
  serial: "302501234567", 
  firmwareESP: "2.1.1",
  firmwareSTM: "2.1.1",
  hardware: "4.2"
};

// Device settings
let deviceSettings = {
  rfidSupported: true,
  autoPlug: true,
  fastCharging: true,
  language: "en",
  limitA: 16,
  limitTimeHours: 0,
  limitTimeMinutes: 0
};

// Device state with new telemetry structure
let deviceState = {
  status: "disconnected", // "disconnected", "connected", "charging", etc.
  voltageV: 230,
  currentA: 0,
  powerkWh: 0,
  phases: 1,
  temperatureC: 38,
  connectedClients: new Set(),
  energykW: 0, // Current session energy in kWh (for billing)
  energyKWh: 0, // Total lifetime energy consumed (for logging)
  isCharging: false,
  currentRFID: null,
  sessionStartEnergy: 0
};

// Network configuration state  
let networkConfig = {
  mode: 'hotspot',    // 'hotspot' for AP mode, 'wifi' for STA mode
  ssid: null,         
  password: null,     
  local: false        
};

// Session management - new protocol structure
let sessionCounter = 1; // Incremental session counter (9 digits)
let currentSession = null; // Active session object
let chargingSessions = []; // Store all sessions

// New session structure matching protocol v2.1:
// {
//   sessionId: "session_000000001", // session + 9 digit number
//   sessionStatus: "started" | "completed" | null,
//   sessionUserId: "user_1234567" | null, // user who started (null for RFID)
//   startAt: "2025-11-06T18:00:00.000Z", // ISO format
//   endAt: "2025-11-06T19:00:00.000Z" | null, // ISO format or null
//   energykW: 56.35, // floating point in kW (session energy)
//   rfidId: "123456789" | null, // RFID ID or null for manual
//   unsynced: true // flag to track if session needs to be synced with app
// }

// RFID management - new protocol structure
let rfids = [
  // New RFID structure:
  // {
  //   number: 1,      // sequential number
  //   id: "1001",     // RFID tag ID
  //   userId: "user123" // associated user ID
  // }
  // Example structure (remove in production):
  // {
  //   rfidId: "RFID#123456",
  //   label: "Dad Card", 
  //   ownerUid: "ABC12345",
  //   ownerName: "Ali",
  //   createdAt: 1758890000
  // }
];

// Load persisted RFIDs and sessions (if available)
try {
  const loadedRFIDs = loadJSON(RFIDS_FILE, null);
  if (loadedRFIDs && Array.isArray(loadedRFIDs)) {
    rfids = loadedRFIDs;
    console.log(`💾 Loaded ${rfids.length} RFIDs from disk`);
  }
} catch {}

// Load persisted network configuration
// DISABLED: Always start in hotspot mode for testing
// try {
//   const loadedNetworkConfig = loadJSON(NETWORK_CONFIG_FILE, null);
//   if (loadedNetworkConfig) {
//     networkConfig = { ...networkConfig, ...loadedNetworkConfig };
//     console.log(`💾 Loaded network config: mode=${networkConfig.mode}, ssid=${networkConfig.ssid || 'none'}`);
//   }
// } catch {}
console.log(`📡 Starting in AP (Hotspot) mode - network config persistence disabled`);

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Find available port if default is busy
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, '0.0.0.0', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

// Persistence: file paths and helpers
const DATA_DIR = __dirname;
const RFIDS_FILE = path.join(DATA_DIR, 'rfids.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const NETWORK_CONFIG_FILE = path.join(DATA_DIR, 'network-config.json');
const CONFIG_FILE = path.join(DATA_DIR, 'device-config.json');

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log(`⚠️  Failed to load ${path.basename(filePath)}:`, e.message);
  }
  return fallback;
}

function saveJSON(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (e) {
    console.log(`⚠️  Failed to save ${path.basename(filePath)}:`, e.message);
  }
}

// Get device IP based on mode
function getDeviceIP() {
  if (networkConfig.mode === 'hotspot') {
    // In development mode, use localhost, in production use charger IP
    if (config.devMode) {
      return 'localhost';
    }
    return '192.168.1.10'; // Fixed IP for AP mode - real chargers use this IP
  }
  return getLocalIP(); // Dynamic IP in Wi-Fi mode
}

// Real WiFi Hotspot Management
class WiFiHotspot {
  constructor() {
    this.isActive = false;
    this.ssid = `WiseCar-${config.deviceId.slice(-6)}`;
    this.password = 'charger2025';
  }

  async createWindowsHotspot() {
    try {
      console.log('📡 Creating Windows mobile hotspot...');
      
      // Stop any existing hotspot
      await execAsync('netsh wlan stop hostednetwork').catch(() => {});
      
      // Configure hotspot
      await execAsync(`netsh wlan set hostednetwork mode=allow ssid="${this.ssid}" key="${this.password}"`);
      
      // Start hotspot
      const result = await execAsync('netsh wlan start hostednetwork');
      
      if (result.stdout.includes('started') || result.stdout.includes('The hosted network started')) {
        this.isActive = true;
        console.log('✅ WiFi Hotspot created successfully!');
        console.log(`📡 SSID: ${this.ssid}`);
        console.log(`🔑 Password: ${this.password}`);
        console.log('📱 Connect your phone to this network to access the charger');
        console.log(`🌐 Access at: http://192.168.1.10:${config.port}`);
        return true;
      } else {
        throw new Error('Failed to start hotspot');
      }
    } catch (error) {
      console.log('❌ Failed to create Windows hotspot:', error.message);
      console.log('💡 Running in simulation mode - connect to same network as PC');
      return false;
    }
  }

  async stopHotspot() {
    try {
      await execAsync('netsh wlan stop hostednetwork');
      this.isActive = false;
      console.log('📡 Windows hotspot stopped');
    } catch (error) {
      console.log('⚠️  Error stopping hotspot:', error.message);
    }
  }

  getConnectionInfo() {
    return {
      ssid: this.ssid,
      password: this.password,
      ip: '192.168.1.10',
      active: this.isActive
    };
  }
}

// Initialize WiFi hotspot manager
const wifiHotspot = new WiFiHotspot();

// Device information for WiseCar app handshake
function getDeviceInfo() {
  // Use realistic values or those from config/deviceInfo
  const startDate = new Date('2025-10-30T12:34:56.789Z');
  const endDate = new Date('2026-10-31T12:34:56.789Z');
  return {
    event: 'hello',
    deviceId: config.deviceId,
    info: {
      model: 'WTL-22KW',
      serial: deviceInfo.serial,
      firmwareESP: deviceInfo.firmwareESP,
      firmwareSTM: deviceInfo.firmwareSTM,
      hardware: deviceInfo.hardware
    },
    settings: {
      rfidSupported: deviceSettings.rfidSupported,
      autoPlug: deviceSettings.autoPlug,
      fastCharging: deviceSettings.fastCharging,
      language: deviceSettings.language,
      limitA: deviceSettings.limitA
    },
    warranty: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    rfids: rfids.map(rfid => ({
      number: rfid.number,
      id: rfid.id,
      userId: rfid.userId
    })),
    network: {
      mode: networkConfig.mode,
      ssid: networkConfig.mode === 'hotspot' ? `WiseCar-${config.deviceId.slice(-6)}` : networkConfig.ssid,
      connected: true,
      local: networkConfig.local || false
    },
    status: {
      charging: deviceState.isCharging,
      connected: deviceState.connectedClients.size > 0,
      error: null,
      lastUpdate: new Date().toISOString()
    }
  };
}

// Generate telemetry data matching WiseCar app protocol
function generateTelemetry() {
  // Update device state with realistic values
  if (deviceState.connectedClients.size > 0) {
    deviceState.status = deviceState.isCharging ? 'charging' : 'connected';
  } else {
    deviceState.status = 'disconnected';
  }
  
  // Simulate charging behavior
  deviceState.voltageV = Math.floor(220 + Math.random() * 20); // 220-240V integer
  
  if (deviceState.isCharging) {
    deviceState.currentA = parseFloat((deviceSettings.limitA * (0.8 + Math.random() * 0.4)).toFixed(2)); // floating point
    deviceState.powerkWh = parseFloat((deviceState.voltageV * deviceState.currentA / 1000 * deviceState.phases).toFixed(2)); // kWh floating point
    
    // Increment session energy
    if (currentSession) {
      const energyIncrement = deviceState.powerkWh / 3600; // Convert to kW per second
      deviceState.energykW += energyIncrement;
      deviceState.energykW = parseFloat(deviceState.energykW.toFixed(3));
      
      // Also track total device energy
      deviceState.energyKWh += energyIncrement;
      deviceState.energyKWh = parseFloat(deviceState.energyKWh.toFixed(3));
    }
  } else {
    deviceState.currentA = 0;
    deviceState.powerkWh = 0;
  }
  
  // Build telemetry message according to WiseCar app protocol
  const telemetryMessage = {
    event: "telemetry",
    deviceId: config.deviceId,
    telemetry: {
      status: deviceState.status,
      voltageV: deviceState.voltageV,
      currentA: deviceState.currentA,
      powerkW: (deviceState.currentA * deviceState.voltageV / 1000), // Instantaneous power in kW
      phases: deviceState.phases,
      temperatureC: deviceState.temperatureC,
      updatedAt: new Date().toISOString()
    },
    lastSession: currentSession ? {
      sessionId: currentSession.sessionId,
      sessionStatus: currentSession.sessionStatus,
      sessionUserId: currentSession.sessionUserId,
      startAt: currentSession.startAt, // WiseCar uses 'startAt' not 'start'
      endAt: currentSession.endAt,     // WiseCar uses 'endAt' not 'end'
      energykWh: deviceState.energykW, // Accumulated energy in kWh for this session
      rfidId: currentSession.rfidId
    } : null
  };
  
  // Log detailed telemetry when charging
  if (deviceState.isCharging && currentSession) {
    console.log(`⚡ CHARGING TELEMETRY:`);
    console.log(`   Session: ${currentSession.sessionId}`);
    console.log(`   Status: ${deviceState.status}`);
    console.log(`   Power: ${deviceState.currentA}A × ${deviceState.voltageV}V = ${(deviceState.currentA * deviceState.voltageV / 1000).toFixed(2)}kW`);
    console.log(`   Session Energy: ${deviceState.energykW.toFixed(2)} kWh`);
    console.log(`   Temperature: ${deviceState.temperatureC}°C`);
    console.log(`   User: ${currentSession.sessionUserId || 'RFID: ' + currentSession.rfidId}`);
    console.log(`   Duration: ${Math.floor((new Date() - new Date(currentSession.startAt)) / 60000)} minutes`);
  }
  
  return telemetryMessage;
}

// RFID helper functions - updated for protocol v2.1
function findRFIDById(id) {
  return rfids.find(rfid => rfid.id === id);
}

function getNextRFIDNumber() {
  return rfids.length > 0 ? Math.max(...rfids.map(r => r.number)) + 1 : 1;
}

function addRFIDs(rfidArray) {
  let added = 0;
  for (const rfidData of rfidArray) {
    // Check if RFID already exists
    const existing = findRFIDById(rfidData.id);
    if (!existing) {
      rfids.push({
        number: getNextRFIDNumber(),
        id: rfidData.id,
        userId: rfidData.userId
      });
      added++;
    }
  }
  saveJSON(RFIDS_FILE, rfids);
  console.log(`📋 Added ${added} new RFIDs`);
  return { success: true, added };
}

function tapRFID(rfidId) {
  const rfid = findRFIDById(rfidId);
  if (!rfid) {
    return { success: false, msg: `RFID ${rfidId} not found in authorized list` };
  }

  // Check if this RFID is currently charging
  if (deviceState.isCharging && deviceState.currentRFID === rfidId) {
    // Stop charging session
    const session = stopChargingSession('RFID tap stop');
    return { 
      success: true, 
      msg: `Charging stopped for RFID ${rfid.id}`,
      session: session
    };
  } else if (!deviceState.isCharging) {
    // Start new charging session
    const session = startChargingSession('rfid', rfidId);
    return { 
      success: true, 
      msg: `Charging started for RFID ${rfid.id}`,
      session: session
    };
  } else {
    // Different RFID tapped while charging
    const currentRfid = findRFIDById(deviceState.currentRFID);
    return { 
      success: false, 
      msg: `Cannot tap RFID ${rfid.id} - ${currentRfid?.id || 'Unknown'} is currently charging` 
    };
  }
}

function addRFID(rfidData) {
  // Check if RFID already exists
  const existing = findRFIDById(rfidData.id);
  if (existing) {
    return { success: false, msg: 'RFID already exists' };
  }
  
  rfids.push({
    number: getNextRFIDNumber(),
    id: rfidData.id,
    userId: rfidData.userId || 'unknown'
  });
  
  saveJSON(RFIDS_FILE, rfids);
  console.log(`📋 RFID added: ${rfidData.id}`);
  return { success: true, msg: 'RFID added successfully' };
}

function deleteRFID(rfidId) {
  const index = rfids.findIndex(rfid => rfid.id === rfidId);
  if (index === -1) {
    return { success: false, msg: 'RFID not found' };
  }
  
  // Stop charging session if this RFID is currently active
  if (deviceState.currentRFID === rfidId) {
    stopChargingSession('RFID deleted');
  }
  
  const deletedRFID = rfids.splice(index, 1)[0];
  saveJSON(RFIDS_FILE, rfids);
  console.log(`❌ RFID deleted: ${rfidId}`);
  return { success: true, msg: 'RFID deleted successfully' };
}

// Sync RFIDs from App (replaces entire RFID array) - Protocol v2.1
function syncRFIDs(newRFIDs) {
  if (!Array.isArray(newRFIDs)) {
    return { success: false, msg: 'Invalid RFID array' };
  }
  
  // Convert and validate RFID data for new protocol v2.1
  const processedRFIDs = [];
  
  for (let i = 0; i < newRFIDs.length; i++) {
    const rfidData = newRFIDs[i];
    let processedRFID;
    
    if (typeof rfidData === 'string') {
      // Handle simple string format
      processedRFID = {
        number: i + 1,
        id: rfidData,
        userId: 'unknown'
      };
    } else if (rfidData && typeof rfidData === 'object') {
      // Handle object format - support both old and new structures
      const idValue = rfidData.id || rfidData.rfidId || rfidData.rfid || rfidData.uid;
      if (!idValue) {
        console.log(`⚠️  Invalid RFID object at index ${i} (missing id):`, rfidData);
        continue;
      }
      
      processedRFID = {
        number: i + 1,
        id: String(idValue),
        userId: rfidData.userId || rfidData.ownerUid || rfidData.ownerId || 'unknown'
      };
    } else {
      console.log(`⚠️  Invalid RFID format at index ${i}:`, rfidData);
      continue;
    }
    
    processedRFIDs.push(processedRFID);
  }
  
  // Stop current session if active RFID is no longer in sync list
  if (deviceState.currentRFID) {
    const stillExists = processedRFIDs.some(rfid => rfid.rfidId === deviceState.currentRFID);
    if (!stillExists) {
      stopChargingSession('RFID removed during sync');
    }
  }
  
  rfids = processedRFIDs;
  saveJSON(RFIDS_FILE, rfids);
  console.log(`📋 RFIDs synced from app: ${rfids.length} RFIDs`);
  
  // Log each RFID for debugging
  rfids.forEach((rfid, index) => {
    console.log(`   ${index + 1}. ${rfid.id} (User: ${rfid.userId})`);
  });
  
  return { success: true, msg: `Synced ${rfids.length} RFIDs successfully` };
}

// Session management - new protocol v2.1
function generateSessionId() {
  const paddedNumber = sessionCounter.toString().padStart(9, '0');
  sessionCounter++;
  return `session_${paddedNumber}`;
}

// Test function to create sample sessions for testing unsynced functionality
function createTestSessions() {
  const testSessions = [
    {
      sessionId: "session_000000001",
      sessionStatus: "completed",
      sessionUserId: "oky4MSvzXdg4bgOJWpV3nLlLct32",
      startAt: "2025-11-08T09:00:00.000Z",
      endAt: "2025-11-08T09:30:00.000Z",
      energykW: 5.25,
      rfidId: "RFID#123456",
      unsynced: true
    },
    {
      sessionId: "session_000000002",
      sessionStatus: "completed",
      sessionUserId: "oky4MSvzXdg4bgOJWpV3nLlLct32",
      startAt: "2025-11-08T10:00:00.000Z",
      endAt: "2025-11-08T10:45:00.000Z",
      energykW: 7.80,
      rfidId: null,
      unsynced: true
    },
    {
      sessionId: "session_000000003",
      sessionStatus: "completed",
      sessionUserId: "user_test123",
      startAt: "2025-11-08T11:00:00.000Z",
      endAt: "2025-11-08T12:15:00.000Z",
      energykW: 12.45,
      rfidId: "RFID#789012",
      unsynced: true
    },
    {
      sessionId: "session_000000004",
      sessionStatus: "completed",
      sessionUserId: "oky4MSvzXdg4bgOJWpV3nLlLct32",
      startAt: "2025-11-08T13:00:00.000Z",
      endAt: "2025-11-08T14:30:00.000Z",
      energykW: 15.20,
      rfidId: null,
      unsynced: true
    },
    {
      sessionId: "session_000000005",
      sessionStatus: "completed",
      sessionUserId: "oky4MSvzXdg4bgOJWpV3nLlLct32",
      startAt: "2025-11-08T15:00:00.000Z",
      endAt: "2025-11-08T16:00:00.000Z",
      energykW: 8.75,
      rfidId: "RFID#345678",
      unsynced: true
    },
    {
      sessionId: "session_000000006",
      sessionStatus: "completed",
      sessionUserId: "user_test456",
      startAt: "2025-11-08T17:00:00.000Z",
      endAt: "2025-11-08T18:30:00.000Z",
      energykW: 18.90,
      rfidId: null,
      unsynced: true
    },
    {
      sessionId: "session_000000007",
      sessionStatus: "completed",
      sessionUserId: "oky4MSvzXdg4bgOJWpV3nLlLct32",
      startAt: "2025-11-08T19:00:00.000Z",
      endAt: "2025-11-08T20:45:00.000Z",
      energykW: 22.30,
      rfidId: "RFID#901234",
      unsynced: true
    }
  ];
  
  // Add test sessions to the array, updating sessionCounter
  testSessions.forEach(session => {
    chargingSessions.push(session);
    const sessionNum = parseInt(session.sessionId.split('_')[1]);
    if (sessionNum >= sessionCounter) {
      sessionCounter = sessionNum + 1;
    }
  });
  
  console.log(`🧪 Created ${testSessions.length} test sessions for unsynced testing`);
  console.log(`📊 Total sessions: ${chargingSessions.length}, Next session counter: ${sessionCounter}`);
  
  // Save to file
  saveJSON(SESSIONS_FILE, chargingSessions);
}

function startChargingSession(userId = null, rfidId = null) {
  // Stop any existing session first
  if (currentSession) {
    stopChargingSession('Previous session auto-stopped');
  }
  
  const now = new Date();
  
  currentSession = {
    sessionId: generateSessionId(),
    sessionStatus: "charging",
    sessionUserId: userId, // user who started (null for RFID)
    startAt: now.toISOString(),
    endAt: null,
    energykW: 0, // Session energy starts at 0
    rfidId: rfidId, // RFID ID or null for manual
    unsynced: true // Mark as unsynced initially
  };
  
  // Add to sessions array
  chargingSessions.push(currentSession);
  
  // Update device state
  deviceState.isCharging = true;
  deviceState.currentRFID = rfidId;
  deviceState.energykW = 0; // Reset session energy counter
  
  console.log(`🔌 Session started: ${currentSession.sessionId} (${rfidId ? 'RFID' : 'Manual'})`);
  
  // Broadcast charging start event to all clients
  console.log(`📡 Broadcasting charging start event to ${deviceState.connectedClients.size} clients`);
  broadcastToClients({
    type: "event",
    command: "start_charging",
    success: true,
    data: {
      sessionId: currentSession.sessionId,
      startTime: currentSession.startAt,
      message: "Charging started successfully"
    },
    timestamp: now.toISOString()
  });
  
  return currentSession;
}

function stopChargingSession(reason = 'Session ended') {
  if (!currentSession) {
    return null;
  }
  
  const now = new Date();
  
  // Update current session
  currentSession.endAt = now.toISOString();
  currentSession.sessionStatus = "completed";
  currentSession.energykW = deviceState.energykW; // Set final energy delivered
  
  // Update device state
  deviceState.isCharging = false;
  deviceState.currentRFID = null;
  
  console.log(`⏹️  Session completed: ${currentSession.sessionId} | Energy: ${deviceState.energykW.toFixed(3)} kW`);
  
  const completedSession = currentSession;
  
  // Broadcast charging stop event to all clients
  console.log(`📡 Broadcasting charging stop event to ${deviceState.connectedClients.size} clients`);
  broadcastToClients({
    type: "event",
    command: "stop_charging",
    success: true,
    data: {
      sessionId: completedSession.sessionId,
      endTime: completedSession.endAt,
      energyDelivered: deviceState.energykW,
      message: "Charging stopped successfully"
    },
    timestamp: now.toISOString()
  });
  
  currentSession = null; // Clear active session
  
  return completedSession;
}

function getSessionHistory(limit = 50) {
  return chargingSessions
    .slice(-limit) // Get last N sessions
    .sort((a, b) => b.startTime - a.startTime); // Most recent first
}

function getActiveSession() {
  return currentSession;
}

// Simulate RFID scan (toggle charging session)
// Legacy function kept for any remaining references
function simulateRFIDScan(rfidId) {
  return tapRFID(rfidId);
}

// Broadcast message to all connected WebSocket clients
function broadcastToClients(message) {
  console.log(`📡 Broadcasting message to ${deviceState.connectedClients.size} clients:`, JSON.stringify(message, null, 2));
  deviceState.connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      console.log(`✅ Sent to client: ${message.type} - ${message.command || message.event}`);
    } else {
      console.log(`❌ Client connection not open, readyState: ${ws.readyState}`);
    }
  });
}

// Disconnect all clients (simulates device disconnection)
function disconnectAllClients(reason = 'Device disconnect') {
  console.log(`🔌 Disconnecting all clients: ${reason}`);
  
  // Send disconnect notification first
  const disconnectMessage = {
    event: 'device_disconnect',
    reason: reason,
    timestamp: Math.floor(Date.now() / 1000)
  };
  
  broadcastToClients(disconnectMessage);
  
  // Close all WebSocket connections after a brief delay
  setTimeout(() => {
    deviceState.connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, reason); // Normal closure with reason
      }
    });
    deviceState.connectedClients.clear();
    console.log('🔌 All clients disconnected');
  }, 500); // 500ms delay to ensure message is sent
}

// Handle client commands - Protocol v2.1 with legacy support
function handleCommand(ws, message) {
  try {
    const command = JSON.parse(message);
    
    // Protocol v2.1 - Handle new format with "type" field
    if (command.type) {
      handleProtocolV21Command(ws, command);
      return;
    }
    
    // WiseCar App Protocol - Handle config commands
    if (command.config) {
      handleConfigCommand(ws, command);
      return;
    }
    
    // WiseCar App Protocol - Handle action commands  
    if (command.action) {
      handleActionCommand(ws, command);
      return;
    }
    
    // WiseCar App Protocol - Handle system commands
    if (command.command) {
      handleSystemCommand(ws, command);
      return;
    }
    
    // Legacy protocol support
    let response = { ack: false, msg: 'Unknown command' };
    const action = command.action || command.command;
    
    switch (action) {
      case 'network':
        if (typeof command.ssid === 'string' && typeof command.password === 'string') {
          // Update network configuration
          networkConfig.ssid = command.ssid;
          networkConfig.password = command.password;
          networkConfig.local = !!command.local;
          networkConfig.mode = 'wifi'; // Switch to wifi mode after configuration
          
          // Persist network configuration
          saveJSON(NETWORK_CONFIG_FILE, networkConfig);
          
          response = {
            command: 'ack',
            ssid: command.ssid,
            status: 'ok',
            message: 'Network configuration saved. Device remains connected for simulator testing.'
          };
          console.log(`📡 Network configured: SSID=${command.ssid}, mode=wifi`);
          console.log(`⚠️  NOTE: Simulator does not actually switch networks - it stays at the same IP`);
          console.log(`💡 For testing: Keep your phone on the same network as this PC`);
          
          // Broadcast updated device info to all clients (they stay connected)
          setTimeout(() => {
            const updatedInfo = getDeviceInfo();
            updatedInfo.event = 'network_updated';
            updatedInfo.message = 'Network configuration updated. Connection maintained for testing.';
            broadcastToClients(updatedInfo);
            console.log(`📡 Broadcasted network update to ${deviceState.connectedClients.size} clients`);
          }, 500);
        } else {
          response = {
            command: 'ack',
            ssid: command.ssid || null,
            status: 'error',
            msg: 'Invalid network parameters (ssid and password required)'
          };
        }
        break;
        
      // Legacy charging control commands...
      case 'start':
        if (!deviceState.isCharging) {
          const session = startChargingSession('manual');
          response = { 
            ack: true, 
            msg: 'Charging started',
            session: session
          };
          console.log('📱 Command: Start charging');
        } else {
          response = { ack: false, msg: 'Already charging' };
        }
        break;
        
      case 'stop':
        if (deviceState.isCharging) {
          const session = stopChargingSession('Manual stop via WebSocket');
          response = { 
            ack: true, 
            msg: 'Charging stopped',
            session: session
          };
          console.log('📱 Command: Stop charging');
        } else {
          response = { ack: false, msg: 'Not charging' };
        }
        break;
      
      // Other legacy commands...
      default:
        response = { ack: false, msg: `Unknown action: ${action}` };
        break;
    }
    
    ws.send(JSON.stringify(response));
  } catch (error) {
    console.error('❌ Error handling command:', error);
    ws.send(JSON.stringify({ ack: false, msg: 'Invalid command format' }));
  }
}

// WiseCar App Protocol - Config command handler
function handleConfigCommand(ws, command) {
  let response;
  
  // Accept both 'config' and 'command' for compatibility
  const configKey = command.config || command.command;
  switch (configKey) {
    case 'network':
      if (command.ssid && command.password) {
        networkConfig.ssid = command.ssid;
        networkConfig.password = command.password;
        networkConfig.local = !!command.local;
        networkConfig.mode = 'wifi';
        
        saveJSON(NETWORK_CONFIG_FILE, networkConfig);
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`📡 Network configured: SSID=${command.ssid}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid network parameters"
        };
      }
      break;
      
    case 'fastCharging':
      if (typeof command.value === 'boolean') {
        deviceSettings.fastCharging = command.value;
        saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`⚡ Fast charging ${command.value ? 'enabled' : 'disabled'}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid fastCharging value"
        };
      }
      break;
      
    case 'autoPlug':
      if (typeof command.value === 'boolean') {
        deviceSettings.autoPlug = command.value;
        saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`🔌 Auto plug ${command.value ? 'enabled' : 'disabled'}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid autoPlug value"
        };
      }
      break;
      
    case 'language':
      if (typeof command.value === 'string') {
        deviceSettings.language = command.value;
        saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`🌐 Language set to: ${command.value}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid language value"
        };
      }
      break;
      
    case 'rfidSupported':
      if (typeof command.value === 'boolean') {
        deviceSettings.rfidSupported = command.value;
        saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`🏷️ RFID support ${command.value ? 'enabled' : 'disabled'}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid rfidSupported value"
        };
      }
      break;
      
      case 'set_limitA':
        const limitValue = command.data && typeof command.data.value === 'number' ? command.data.value : undefined;
        if (typeof limitValue === 'number' && Number.isInteger(limitValue) && limitValue >= 1) {
          deviceSettings.limitA = limitValue;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          response = {
            type: 'response',
            command: 'set_limitA',
            success: true,
            data: { value: deviceSettings.limitA },
            timestamp: new Date().toISOString()
          };
          console.log(`⚡ Current limit set to: ${limitValue}A`);
        } else {
          response = {
            type: 'response',
            command: 'set_limitA',
            success: false,
            error: "Invalid current limit (must be a positive integer)",
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'setTime':
        if (command.data && command.data.year && command.data.month && command.data.day && 
            command.data.hour !== undefined && command.data.minute !== undefined && command.data.second !== undefined) {
          
          // Store the device time settings
          deviceSettings.deviceTime = {
            year: command.data.year,
            month: command.data.month,
            day: command.data.day,
            hour: command.data.hour,
            minute: command.data.minute,
            second: command.data.second,
            setAt: new Date().toISOString()
          };
          
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            ack: true,
            msg: "ok"
          };
          console.log(`🕒 Device time set to: ${command.data.year}-${command.data.month.toString().padStart(2,'0')}-${command.data.day.toString().padStart(2,'0')} ${command.data.hour.toString().padStart(2,'0')}:${command.data.minute.toString().padStart(2,'0')}:${command.data.second.toString().padStart(2,'0')}`);
        } else {
          response = {
            ack: false,
            msg: "error",
            error: "Invalid time data - year, month, day, hour, minute, second required"
          };
        }
        break;
        
      case 'set_limitTime':
        if (command.data && 
            typeof command.data.hour === 'number' && command.data.hour >= 0 && command.data.hour <= 23 &&
            typeof command.data.minute === 'number' && command.data.minute >= 0 && command.data.minute <= 59) {
          deviceSettings.limitTimeHours = command.data.hour;
          deviceSettings.limitTimeMinutes = command.data.minute;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            ack: true,
            msg: "ok"
          };
          console.log(`⏰ Charging time limit set to: ${command.data.hour}h ${command.data.minute}m`);
        } else {
          response = {
            ack: false,
            msg: "error",
            error: "Invalid time limit (hour: 0-23, minute: 0-59)"
          };
        }
        break;    default:
      response = {
        ack: false,
        msg: "error",
        error: "Unknown config command"
      };
  }
  
  ws.send(JSON.stringify(response));
}

// WiseCar App Protocol - Action command handler
function handleActionCommand(ws, command) {
  let response;
  
  switch (command.action) {
    case 'start':
      if (!deviceState.isCharging) {
        const sessionType = 'manual';
        const session = startChargingSession(sessionType, null, command.userId);
        
        // Apply fast charging and limit settings
        if (command.fastCharging && deviceSettings.fastCharging) {
          deviceSettings.limitA = 32; // Max current for fast charging
        } else if (command.limitA) {
          deviceSettings.limitA = Math.min(Math.max(command.limitA, 8), 32);
        }
        
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`🚀 Charging started by user ${command.userId}`);
      } else {
        response = {
          ack: false,
          msg: "already charging"
        };
      }
      break;
      
    case 'stop':
      if (deviceState.isCharging) {
        stopChargingSession('User requested stop');
        response = {
          ack: true,
          msg: "ok"
        };
        console.log(`🛑 Charging stopped by user ${command.userId}`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Not charging"
        };
      }
      break;
      
    case 'set_limitA':
      const limitValue = command.data && typeof command.data.value === 'number' ? command.data.value : undefined;
      if (typeof limitValue === 'number' && Number.isInteger(limitValue) && limitValue >= 1) {
        deviceSettings.limitA = limitValue;
        response = {
          type: 'response',
          command: 'set_limitA',
          success: true,
          data: { value: deviceSettings.limitA },
          timestamp: new Date().toISOString()
        };
        console.log(`⚡ Current limit updated to: ${limitValue}A`);
      } else {
        response = {
          type: 'response',
          command: 'set_limitA',
          success: false,
          error: "Invalid current limit (must be a positive integer)",
          timestamp: new Date().toISOString()
        };
      }
      break;
      
    case 'rfid_numbers':
      response = {
        event: "rfid_numbers",
        numbers: rfids.length
      };
      break;
      
    case 'rfid_list':
      response = {
        event: "rfid_list",
        rfids: rfids
      };
      break;
      
    case 'rfid_add':
      if (command.rfids && Array.isArray(command.rfids)) {
        let added = 0;
        for (const rfidData of command.rfids) {
          if (rfidData.id) {
            const existing = findRFIDById(rfidData.id);
            if (!existing) {
              rfids.push({
                number: getNextRFIDNumber(),
                id: rfidData.id,
                userId: rfidData.userId || 'unknown'
              });
              added++;
            }
          }
        }
        saveJSON(RFIDS_FILE, rfids);
        response = {
          event: "rfid_add",
          ok: true
        };
        console.log(`🏷️ Added ${added} RFIDs`);
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Invalid RFID data"
        };
      }
      break;
      
    case 'rfid_delete':
      if (command.rfids && Array.isArray(command.rfids)) {
        let deleted = 0;
        for (const rfidData of command.rfids) {
          if (rfidData.id) {
            const index = rfids.findIndex(r => r.id === rfidData.id);
            if (index !== -1) {
              rfids.splice(index, 1);
              deleted++;
            }
          }
        }
        // Renumber RFIDs
        rfids.forEach((rfid, index) => {
          rfid.number = index + 1;
        });
        saveJSON(RFIDS_FILE, rfids);
        response = {
          event: "rfid_delete",
          ok: true
        };
        console.log(`🗑️ Deleted ${deleted} RFIDs`);
      } else {
        response = {
          ack: false,
          msg: "error", 
          error: "Invalid RFID data"
        };
      }
      break;
      
    case 'rfid_detection':
      // Simulate RFID detection - return a fake RFID after small delay
      setTimeout(() => {
        const fakeRfid = "123456789";
        ws.send(JSON.stringify({
          event: "rfid_detection",
          rfid: fakeRfid
        }));
        console.log(`🏷️ RFID detected: ${fakeRfid}`);
      }, 2000);
      return; // Don't send immediate response
      
    case 'last_session':
      if (sessions.length > 0) {
        const lastSession = sessions[sessions.length - 1];
        response = {
          event: "last_session",
          session: lastSession
        };
      } else {
        response = {
          ack: false,
          msg: "no session"
        };
      }
      break;
      
    case 'get_session':
      if (command.sessionId) {
        const session = sessions.find(s => s.sessionId === command.sessionId);
        if (session) {
          response = {
            event: "get_session",
            session: session
          };
        } else {
          response = {
            ack: false,
            msg: "no session"
          };
        }
      } else {
        response = {
          ack: false,
          msg: "error",
          error: "Session ID required"
        };
      }
      break;
      
    default:
      response = {
        ack: false,
        msg: "error",
        error: "Unknown action"
      };
  }
  
  ws.send(JSON.stringify(response));
}

// WiseCar App Protocol - System command handler
function handleSystemCommand(ws, command) {
  let response;
  
  switch (command.command) {
    case 'ping':
      response = {
        command: "pong"
      };
      break;
      
    default:
      response = {
        ack: false,
        msg: "error",
        error: "Unknown command"
      };
  }
  
  ws.send(JSON.stringify(response));
}

// Protocol v2.1 command handler (DEPRECATED - keeping for reference)
function handleProtocolV21Command(ws, command) {
  let response;
  
  // Config commands
  if (command.type === 'config') {
    switch (command.command) {
      case 'network':
        if (command.data && typeof command.data.ssid === 'string' && typeof command.data.password === 'string') {
          // Update network configuration
          networkConfig.ssid = command.data.ssid;
          networkConfig.password = command.data.password;
          networkConfig.local = !!command.data.local;
          networkConfig.mode = 'wifi';
          
          saveJSON(NETWORK_CONFIG_FILE, networkConfig);
          
          response = {
            type: 'response',
            command: 'network',
            success: true,
            data: {
              ssid: command.data.ssid,
              status: 'configured',
              message: 'Network configuration saved'
            },
            timestamp: new Date().toISOString()
          };
          console.log(`📡 Network configured: SSID=${command.data.ssid}`);
        } else {
          response = {
            type: 'response',
            command: 'network',
            success: false,
            error: 'Invalid network parameters',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'add_rfid':
        if (command.data && command.data.id) {
          const result = addRFID({
            id: command.data.id,
            userId: command.data.userId || 'unknown'
          });
          response = {
            type: 'response',
            command: 'add_rfid',
            success: result.success,
            data: result.success ? { id: command.data.id, message: result.msg } : null,
            error: result.success ? null : result.msg,
            timestamp: new Date().toISOString()
          };
        } else {
          response = {
            type: 'response',
            command: 'add_rfid',
            success: false,
            error: 'Invalid RFID data - id required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'delete_rfid':
        if (command.data && command.data.id) {
          const result = deleteRFID(command.data.id);
          response = {
            type: 'response',
            command: 'delete_rfid',
            success: result.success,
            data: result.success ? { id: command.data.id, message: result.msg } : null,
            error: result.success ? null : result.msg,
            timestamp: new Date().toISOString()
          };
        } else {
          response = {
            type: 'response',
            command: 'delete_rfid',
            success: false,
            error: 'RFID ID required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'fastCharging':
        if (command.data && typeof command.data.value === 'boolean') {
          deviceSettings.fastCharging = command.data.value;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            type: 'response',
            command: 'fastCharging',
            success: true,
            data: {
              value: command.data.value,
              message: 'Fast charging setting updated'
            },
            timestamp: new Date().toISOString()
          };
          console.log(`⚡ Fast charging ${command.data.value ? 'enabled' : 'disabled'}`);
        } else {
          response = {
            type: 'response',
            command: 'fastCharging',
            success: false,
            error: 'Invalid fastCharging value - boolean required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'autoPlug':
        if (command.data && typeof command.data.value === 'boolean') {
          deviceSettings.autoPlug = command.data.value;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            type: 'response',
            command: 'autoPlug',
            success: true,
            data: {
              value: command.data.value,
              message: 'Auto plug setting updated'
            },
            timestamp: new Date().toISOString()
          };
          console.log(`🔌 Auto plug ${command.data.value ? 'enabled' : 'disabled'}`);
        } else {
          response = {
            type: 'response',
            command: 'autoPlug',
            success: false,
            error: 'Invalid autoPlug value - boolean required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'language':
        if (command.data && typeof command.data.value === 'string') {
          deviceSettings.language = command.data.value;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            type: 'response',
            command: 'language',
            success: true,
            data: {
              value: command.data.value,
              message: 'Language setting updated'
            },
            timestamp: new Date().toISOString()
          };
          console.log(`🌐 Language set to: ${command.data.value}`);
        } else {
          response = {
            type: 'response',
            command: 'language',
            success: false,
              timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'setTime':
        if (command.data && command.data.year && command.data.month && command.data.day && 
            command.data.hour !== undefined && command.data.minute !== undefined && command.data.second !== undefined) {
          
          // Store the device time settings
          deviceSettings.deviceTime = {
            year: command.data.year,
            month: command.data.month,
            day: command.data.day,
            hour: command.data.hour,
            minute: command.data.minute,
            second: command.data.second,
            setAt: new Date().toISOString()
          };
          
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            type: 'response',
            command: 'setTime',
            success: true,
            data: {
              message: 'Device time set successfully',
              setTime: `${command.data.year}-${command.data.month.toString().padStart(2,'0')}-${command.data.day.toString().padStart(2,'0')} ${command.data.hour.toString().padStart(2,'0')}:${command.data.minute.toString().padStart(2,'0')}:${command.data.second.toString().padStart(2,'0')}`
            },
            timestamp: new Date().toISOString()
          };
          console.log(`🕒 Device time set to: ${command.data.year}-${command.data.month.toString().padStart(2,'0')}-${command.data.day.toString().padStart(2,'0')} ${command.data.hour.toString().padStart(2,'0')}:${command.data.minute.toString().padStart(2,'0')}:${command.data.second.toString().padStart(2,'0')}`);
        } else {
          response = {
            type: 'response',
            command: 'setTime',
            success: false,
            error: 'Invalid time data - year, month, day, hour, minute, second required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'set_limitTime':
        if (command.data && 
            typeof command.data.hour === 'number' && command.data.hour >= 0 && command.data.hour <= 23 &&
            typeof command.data.minute === 'number' && command.data.minute >= 0 && command.data.minute <= 59) {
          deviceSettings.limitTimeHours = command.data.hour;
          deviceSettings.limitTimeMinutes = command.data.minute;
          saveJSON(CONFIG_FILE, { deviceInfo, deviceSettings, networkConfig });
          
          response = {
            type: 'response',
            command: 'set_limitTime',
            success: true,
            data: {
              hour: command.data.hour,
              minute: command.data.minute,
              message: 'Set limit time setting updated'
            },
            timestamp: new Date().toISOString()
          };
          console.log(`⏰ Charging time limit set to: ${command.data.hour}h ${command.data.minute}m`);
        } else {
          response = {
            type: 'response',
            command: 'set_limitTime',
            success: false,
            error: 'Invalid time limit (hour: 0-23, minute: 0-59)',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      default:
        response = {
          type: 'response',
          command: command.command,
          success: false,
          error: 'Unknown config command',
          timestamp: new Date().toISOString()
        };
    }
  }
  
  // Action commands
  else if (command.type === 'action') {
    switch (command.command) {
      case 'start_charging':
        if (!deviceState.isCharging) {
          const session = startChargingSession('manual');
          response = {
            type: 'response',
            command: 'start_charging',
            success: true,
            data: {
              sessionId: session.sessionId,
              startTime: session.startAt,
              message: 'Charging started successfully'
            },
            timestamp: new Date().toISOString()
          };
          console.log('� Command: Start charging (v2.1)');
        } else {
          response = {
            type: 'response',
            command: 'start_charging',
            success: false,
            error: 'Device is already charging',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'stop_charging':
        if (deviceState.isCharging) {
          const session = stopChargingSession('Manual stop via WebSocket');
          response = {
            type: 'response',
            command: 'stop_charging',
            success: true,
            data: {
              sessionId: session.sessionId,
              endTime: session.endAt,
              energyConsumed: deviceState.energykW,
              message: 'Charging stopped successfully'
            },
            timestamp: new Date().toISOString()
          };
          console.log('📱 Command: Stop charging (v2.1)');
        } else {
          response = {
            type: 'response',
            command: 'stop_charging',
            success: false,
            error: 'Device is not charging',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      case 'get_unsynced_sessions':
        const unsyncedSessions = chargingSessions.filter(s => s.unsynced === true);
        const batchSize = 5; // Send maximum 5 sessions at a time
        const sessionsBatch = unsyncedSessions.slice(0, batchSize);
        
        response = {
          type: 'response',
          command: 'get_unsynced_sessions',
          success: true,
          data: {
            sessions: sessionsBatch.map(session => ({
              sessionId: session.sessionId,
              startAt: session.startAt,
              endAt: session.endAt,
              energykW: session.energykW,
              rfidId: session.rfidId
            })),
            count: sessionsBatch.length
          },
          timestamp: new Date().toISOString()
        };
        
        // Mark the sent sessions as synced
        sessionsBatch.forEach(session => {
          const index = chargingSessions.findIndex(s => s.sessionId === session.sessionId);
          if (index !== -1) {
            chargingSessions[index].unsynced = false;
          }
        });
        
        // Save updated sessions to file
        saveJSON(SESSIONS_FILE, chargingSessions);
        
        console.log(`📊 Command: Get unsynced sessions - Sent ${sessionsBatch.length} of ${unsyncedSessions.length} unsynced sessions`);
        break;
        
      case 'ping':
        response = {
          type: 'response',
          command: 'ping',
          success: true,
          data: {
            message: 'pong',
            deviceStatus: 'connected'
          },
          timestamp: new Date().toISOString()
        };
        console.log('🏓 Command: Ping - Pong response sent');
        break;
        
      case 'get_status':
        response = {
          type: 'response',
          command: 'get_status',
          success: true,
          data: {
            status: deviceState.status,
            isCharging: deviceState.isCharging,
            connectedClients: deviceState.connectedClients.size,
            currentSession: currentSession ? {
              sessionId: currentSession.sessionId,
              sessionStatus: currentSession.sessionStatus,
              sessionUserId: currentSession.sessionUserId,
              startAt: currentSession.startAt,
              endAt: currentSession.endAt,
              energykWh: deviceState.energykW,
              rfidId: currentSession.rfidId
            } : null,
            totalEnergy: deviceState.energyKWh,
            uptime: getUptime(),
            deviceId: deviceId // <-- Added for validation
          },
          timestamp: new Date().toISOString()
        };
        console.log('📊 Command: Get status - Device status sent');
        break;
        
      default:
        response = {
          type: 'response',
          command: command.command,
          success: false,
          error: 'Unknown action command',
          timestamp: new Date().toISOString()
        };
    }
  }
  
  // Event handling
  else if (command.type === 'event') {
    switch (command.event) {
      case 'rfid_tap':
        if (command.data && command.data.id) {
          const tapResult = tapRFID(command.data.id);
          
          // Broadcast RFID tap event to all clients
          const tapEvent = {
            type: 'event',
            event: 'rfid_tap',
            data: {
              id: command.data.id,
              success: tapResult.success,
              message: tapResult.msg,
              sessionId: tapResult.session ? tapResult.session.sessionId : null,
              charging: deviceState.isCharging
            },
            timestamp: new Date().toISOString()
          };
          broadcastToClients(tapEvent);
          
          response = {
            type: 'response',
            command: 'rfid_tap',
            success: tapResult.success,
            data: {
              id: command.data.id,
              message: tapResult.msg,
              sessionId: tapResult.session ? tapResult.session.sessionId : null
            },
            timestamp: new Date().toISOString()
          };
        } else {
          response = {
            type: 'response',
            command: 'rfid_tap',
            success: false,
            error: 'RFID ID required',
            timestamp: new Date().toISOString()
          };
        }
        break;
        
      default:
        response = {
          type: 'response',
          command: command.event,
          success: false,
          error: 'Unknown event type',
          timestamp: new Date().toISOString()
        };
    }
  }
  
  // Unknown command type
  else {
    response = {
      type: 'response',
      command: command.command || 'unknown',
      success: false,
      error: 'Unknown command type',
      timestamp: new Date().toISOString()
    };
  }
  
  console.log(`📤 Sending response: ${JSON.stringify(response)}`);
  ws.send(JSON.stringify(response));
}

// Main startup
// Main startup
async function startServer() {
  try {
    // Determine device IP based on mode
    const deviceIP = getDeviceIP();
    const isHotspotMode = networkConfig.mode === 'hotspot';
    
    // Find available ports
    const availableWSPort = await findAvailablePort(config.port);
    const availableHTTPPort = await findAvailablePort(config.httpPort);
    config.port = availableWSPort;
    config.httpPort = availableHTTPPort;

    console.log('🔌 WiseCar Charger Simulator with RFID Support Starting...');
    console.log(`📡 Mode: ${isHotspotMode ? 'AP (Hotspot)' : 'Wi-Fi (LAN)'}`);
    console.log(`🌐 WebSocket Server: ws://${deviceIP}:${config.port}`);
    if (!isHotspotMode) {
      console.log(`🔍 Also available on: ws://localhost:${config.port}`);
      console.log(`🏷️  Hostname for app: ws://${config.deviceId}.local:${config.port}`);
      console.log(`📱 App should connect to: ws://${config.deviceId}.local:${config.port}`);
      console.log(`🔧 If hostname fails, try: ws://${deviceIP}:${config.port}`);
    }
    console.log(`🌐 HTTP Server: http://${deviceIP}:${config.httpPort}`);

    // Create real WiFi hotspot if in hotspot mode
    if (isHotspotMode) {
      const hotspotCreated = await wifiHotspot.createWindowsHotspot();
      if (hotspotCreated) {
        // Update device IP to hotspot IP
        const hotspotInfo = wifiHotspot.getConnectionInfo();
        deviceIP = hotspotInfo.ip;
        console.log(`📡 Real hotspot active - Updated device IP: ${deviceIP}`);
      }
    }

    // Create WebSocket server
    const wss = new WebSocket.Server({ 
      port: config.port,
      host: '0.0.0.0'
    });

    // Create HTTP server for RFID simulation endpoints
    const app = express();
    app.use(express.json());
    // Allow CORS from dashboard and other tools
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    // RFID simulation endpoint
    app.post('/simulate-rfid/:rfidId', (req, res) => {
      const rfidId = req.params.rfidId;
      const result = tapRFID(rfidId);
      
      // Broadcast state change to all clients
      broadcastToClients({
        event: 'state_changed',
        deviceId: config.deviceId,
        isCharging: deviceState.isCharging,
        currentRFID: deviceState.currentRFID,
        energyKWh: deviceState.energyKWh,
        session: result.session || null,
        timestamp: Date.now()
      });
      
      res.json({
        success: result.success,
        message: result.msg,
        rfidId: rfidId,
        charging: deviceState.isCharging,
        currentRFID: deviceState.currentRFID,
        session: result.session || null
      });
    });

    // Get all RFIDs endpoint
    app.get('/rfids', (req, res) => {
      res.json({
        success: true,
        rfids: rfids,
        count: rfids.length
      });
    });

    // Add RFID endpoint
    app.post('/rfids', (req, res) => {
      const result = addRFID(req.body);
      res.json({
        success: result.success,
        message: result.msg,
        rfids: rfids
      });
    });

    // Bulk sync RFIDs from Firestore/App
    app.put('/rfids/sync', (req, res) => {
      const result = syncRFIDs(req.body.rfids || req.body);
      res.json({
        success: result.success,
        message: result.msg,
        rfids: rfids,
        count: rfids.length
      });
    });

    // Delete RFID endpoint
    app.delete('/rfids/:rfidId', (req, res) => {
      const result = deleteRFID(req.params.rfidId);
      res.json({
        success: result.success,
        message: result.msg,
        rfids: rfids
      });
    });

    // Device status endpoint (enhanced with session data)
    app.get('/status', (req, res) => {
      res.json({
        deviceId: config.deviceId,
        charging: deviceState.isCharging,
        energyKWh: deviceState.energyKWh,
        currentRFID: deviceState.currentRFID,
        connectedClients: deviceState.connectedClients.size,
        rfidCount: rfids.length,
        activeSession: currentSession,
        totalSessions: chargingSessions.length
      });
    });

    // Session Management Endpoints
    app.get('/sessions', (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      res.json({
        success: true,
        sessions: getSessionHistory(limit),
        activeSession: getActiveSession(),
        totalSessions: chargingSessions.length
      });
    });

    // Unsynced sessions for cloud sync
    app.get('/sessions/unsynced', (req, res) => {
      const unsynced = chargingSessions.filter(s => s.unsynced === true);
      res.json({ success: true, sessions: unsynced, count: unsynced.length });
    });

    // Acknowledge sessions synced by app
    app.post('/sessions/ack', (req, res) => {
      const ids = req.body.sessionIds;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ success: false, message: 'sessionIds array required' });
      }
      let updated = 0;
      chargingSessions.forEach(s => {
        if (ids.includes(s.sessionId)) {
          if (s.unsynced) { s.unsynced = false; updated++; }
        }
      });
      saveJSON(SESSIONS_FILE, chargingSessions);
      res.json({ success: true, message: `Acknowledged ${updated} sessions` });
    });

    app.get('/sessions/active', (req, res) => {
      const active = getActiveSession();
      if (active) {
        res.json({
          success: true,
          session: active
        });
      } else {
        res.status(404).json({ 
          success: false,
          message: 'No active session' 
        });
      }
    });

    app.post('/sessions/start', (req, res) => {
      const { sessionType = 'manual', rfidId = null } = req.body;
      
      if (deviceState.isCharging) {
        res.status(400).json({ 
          success: false, 
          message: 'Charging already in progress' 
        });
        return;
      }
      
      const session = startChargingSession(sessionType, rfidId);
      res.json({ 
        success: true, 
        message: 'Session started successfully',
        session: session
      });
    });

    app.post('/sessions/stop', (req, res) => {
      const { reason = 'Manual stop' } = req.body;
      
      if (!deviceState.isCharging) {
        res.status(400).json({ 
          success: false, 
          message: 'No active charging session' 
        });
        return;
      }
      
      const session = stopChargingSession(reason);
      res.json({ 
        success: true, 
        message: 'Session stopped successfully',
        session: session
      });
    });

    // Test session management endpoints
    app.post('/test/create-sessions', (req, res) => {
      createTestSessions();
      const unsyncedCount = chargingSessions.filter(s => s.unsynced === true).length;
      res.json({ 
        success: true, 
        message: 'Test sessions created successfully',
        totalSessions: chargingSessions.length,
        unsyncedSessions: unsyncedCount
      });
    });

    app.post('/test/reset-unsynced', (req, res) => {
      // Mark all sessions as unsynced for testing
      chargingSessions.forEach(session => {
        session.unsynced = true;
      });
      saveJSON(SESSIONS_FILE, chargingSessions);
      
      const unsyncedCount = chargingSessions.filter(s => s.unsynced === true).length;
      res.json({ 
        success: true, 
        message: 'All sessions marked as unsynced',
        totalSessions: chargingSessions.length,
        unsyncedSessions: unsyncedCount
      });
    });

    app.get('/test/sessions-status', (req, res) => {
      const unsyncedCount = chargingSessions.filter(s => s.unsynced === true).length;
      const syncedCount = chargingSessions.filter(s => s.unsynced === false).length;
      
      res.json({
        success: true,
        totalSessions: chargingSessions.length,
        unsyncedSessions: unsyncedCount,
        syncedSessions: syncedCount,
        sessions: chargingSessions.map(s => ({
          sessionId: s.sessionId,
          energykW: s.energykW,
          unsynced: s.unsynced,
          startAt: s.startAt,
          endAt: s.endAt
        }))
      });
    });

    // Test endpoints for unsynced sessions
    app.post('/test/create-sessions', (req, res) => {
      try {
        createTestSessions();
        res.json({
          success: true,
          message: 'Test sessions created successfully',
          totalSessions: chargingSessions.length,
          unsyncedSessions: chargingSessions.filter(s => s.unsynced === true).length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    app.get('/test/sessions-status', (req, res) => {
      const unsynced = chargingSessions.filter(s => s.unsynced === true).length;
      const synced = chargingSessions.filter(s => s.unsynced === false).length;
      
      res.json({
        totalSessions: chargingSessions.length,
        unsyncedSessions: unsynced,
        syncedSessions: synced,
        sessions: chargingSessions.map(s => ({
          sessionId: s.sessionId,
          unsynced: s.unsynced,
          startAt: s.startAt,
          endAt: s.endAt,
          energykW: s.energykW
        }))
      });
    });

    app.post('/test/reset-unsynced', (req, res) => {
      try {
        chargingSessions.forEach(session => {
          session.unsynced = true;
        });
        saveJSON(SESSIONS_FILE, chargingSessions);
        
        res.json({
          success: true,
          message: 'All sessions reset to unsynced',
          totalSessions: chargingSessions.length,
          unsyncedSessions: chargingSessions.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    app.listen(config.httpPort, () => {
      console.log(`🌐 HTTP API available at: http://${deviceIP}:${config.httpPort}`);
    });

    // mDNS advertisement (works in both hotspot and Wi-Fi modes)
    let mdnsService = null;
    try {
      // Use deviceId as hostname so app can connect via ws://wtl-202501234567.local:3000
      const hostName = config.deviceId;
      mdnsService = bonjour.publish({
        name: hostName,
        type: config.serviceName,
        port: config.port,
        txt: {
          deviceId: config.deviceId,
          model: 'WT3S',
          firmware: 'v2.0.1',
          serial: 'WC-DEMO-234567',
          rfidSupported: 'true',
          mode: networkConfig.mode,
          ip: deviceIP
        }
      });
      
      console.log(`📻 mDNS Service: ${hostName}.local:${config.port}`);
      console.log(`📋 Service Type: ${config.serviceName}`);
      if (isHotspotMode) {
        console.log(`ℹ️  In AP mode - mDNS available, fixed IP: ${deviceIP}`);
        console.log(`📱 App should connect to: ws://${deviceIP}:${config.port}`);
      } else {
        console.log(`ℹ️  In Wi-Fi mode - mDNS broadcasting device info`);
        console.log(`📱 App should connect to: ws://${hostName}.local:${config.port}`);
        console.log(`🔧 If hostname fails, try: ws://${deviceIP}:${config.port}`);
      }
    } catch (error) {
      console.log('⚠️  mDNS service failed to start:', error.message);
      console.log(`📡 Server still available via direct connection: ws://${deviceIP}:${config.port}`);
    }

    // WebSocket connection handling
    wss.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      const timestamp = new Date().toISOString();
      console.log(`🔗 [${timestamp}] New client connected from ${clientIP}`);
      console.log(`📊 Connection details: ${deviceState.connectedClients.size + 1} clients total`);
      
      deviceState.connectedClients.add(ws);
      
      // Send handshake immediately (includes RFIDs)
      const handshake = getDeviceInfo();
      ws.send(JSON.stringify(handshake));
      console.log('👋 Sent handshake with RFIDs to client');
      
      // Broadcast updated telemetry immediately to reflect connection status change
      setTimeout(() => {
        broadcastToClients(generateTelemetry());
      }, 100);
      
      // Start telemetry interval for this client
      const telemetryInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const telemetry = generateTelemetry();
          ws.send(JSON.stringify(telemetry));
          
          // Log telemetry structure periodically when charging (every 10 seconds)
          if (deviceState.isCharging && Math.floor(Date.now() / 1000) % 10 === 0) {
            console.log('📡 Telemetry sent to client:', JSON.stringify(telemetry, null, 2));
          }
        } else {
          clearInterval(telemetryInterval);
        }
      }, 1000); // WiseCar app expects telemetry every 1 second
      
      // Handle incoming messages
      ws.on('message', (message) => {
        console.log(`📨 Received: ${message}`);
        handleCommand(ws, message);
      });
      
      // Handle disconnection
      ws.on('close', () => {
        const timestamp = new Date().toISOString();
        console.log(`🔌 [${timestamp}] Client disconnected from ${clientIP}`);
        console.log(`📊 Remaining clients: ${deviceState.connectedClients.size - 1}`);
        deviceState.connectedClients.delete(ws);
        clearInterval(telemetryInterval);
        
        // Broadcast updated telemetry immediately to reflect disconnection
        setTimeout(() => {
          broadcastToClients(generateTelemetry());
        }, 100);
      });
      
      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        deviceState.connectedClients.delete(ws);
        clearInterval(telemetryInterval);
      });
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down WiseCar Charger Simulator...');
      
      // Stop WiFi hotspot if active
      if (wifiHotspot.isActive) {
        wifiHotspot.stopHotspot();
      }
      
      if (mdnsService) {
        mdnsService.stop();
        console.log('📻 mDNS service stopped');
      }
      
      wss.close(() => {
        console.log('🔌 WebSocket server closed');
        bonjour.destroy();
        process.exit(0);
      });
    });

    // Log status every 30 seconds
    setInterval(() => {
      const clients = deviceState.connectedClients.size;
      const status = deviceState.isCharging ? 'CHARGING' : 'IDLE';
      const rfidInfo = deviceState.currentRFID ? ` | RFID: ${deviceState.currentRFID}` : '';
      
      if (deviceState.isCharging && currentSession) {
        // Detailed charging status
        const duration = Math.floor((new Date() - new Date(currentSession.startAt)) / 60000);
        const power = (deviceState.currentA * deviceState.voltageV / 1000).toFixed(2);
        console.log(`⚡ CHARGING: Session ${currentSession.sessionId} | ${duration}min | ${power}kW | Energy: ${deviceState.energykW.toFixed(2)}kWh | Clients: ${clients}${rfidInfo}`);
      } else {
        console.log(`📊 Status: ${status} | Clients: ${clients} | Total Energy: ${deviceState.energyKWh.toFixed(2)} kWh${rfidInfo}`);
      }
    }, 10000); // More frequent updates during charging

    console.log('✅ WiseCar Charger Simulator with RFID ready for connections!');
    console.log('💡 Usage:');
    console.log('   WebSocket Commands:');
    console.log('   - {"action": "start"}, {"action": "stop"}');
    console.log('   - {"action": "add_rfid", "rfid": {...}}');
    console.log('   - {"action": "delete_rfid", "rfidId": "RFID#123456"}');
    console.log('   - {"action": "list_rfids"}');
    console.log('   HTTP Endpoints:');
    console.log(`   - POST http://localhost:${config.httpPort}/simulate-rfid/RFID#111111`);
    console.log(`   - GET  http://localhost:${config.httpPort}/rfids`);
    console.log(`   - GET  http://localhost:${config.httpPort}/status`);
    console.log('   - Press Ctrl+C to stop');
    console.log('\n📋 RFID Status:');
    if (rfids.length === 0) {
      console.log('   ⚠️  No RFIDs loaded. Sync from Flutter app using:');
      console.log('      WebSocket: {"action": "sync_rfids", "rfids": [...]}');
      console.log(`      HTTP: PUT http://localhost:${config.httpPort}/rfids/sync`);
    } else {
      console.log(`   ✅ ${rfids.length} RFIDs loaded:`);
      rfids.forEach(rfid => {
        console.log(`      - ${rfid.rfidId}: ${rfid.label} (${rfid.ownerName})`);
      });
    }

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}


// Start the server
startServer();