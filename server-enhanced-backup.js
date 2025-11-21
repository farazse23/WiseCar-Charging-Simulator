const WebSocket = require('ws');
const express = require('express');
const bonjour = require('bonjour')();
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// Configuration
const config = {
  port: process.env.PORT || 3000,
  httpPort: process.env.HTTP_PORT || 3002,
  deviceId: 'wtl-202501234567', // model-serial format
  serviceName: '_wisecar._tcp.local'
};

// Device info structure matching new protocol
const deviceInfo = {
  model: "WTL-22KW",
  serial: "202501234567", 
  firmwareESP: "1.2.3",
  firmwareSTM: "1.2.3",
  hardware: "4.1"
};

// Device settings
let deviceSettings = {
  rfidSupported: true,
  autoPlug: true,
  fastCharging: true,
  language: "en",
  limitA: 16
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
  energykW: 0, // Current session energy
  energyKWh: 0, // Total energy consumed (for logging)
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
//   rfidId: "123456789" | null // RFID ID or null for manual
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
    return '192.168.1.10'; // Fixed IP in AP mode
  }
  return getLocalIP(); // Dynamic IP in Wi-Fi mode
}

// Device information including RFIDs (matching Firestore schema)
function getDeviceInfo() {
  const now = new Date();
  const startDate = new Date('2025-10-30T12:34:56.789Z');
  const endDate = new Date('2026-10-31T12:34:56.789Z');
  
  return {
    event: 'hello',
    deviceId: config.deviceId, // wtl-202501234567
    info: {
      model: deviceInfo.model,          // WTL-22KW
      serial: deviceInfo.serial,        // 202501234567
      firmwareESP: deviceInfo.firmwareESP, // 1.2.3
      firmwareSTM: deviceInfo.firmwareSTM, // 1.2.3
      hardware: deviceInfo.hardware     // 4.1
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
    }
  };
}

// Generate telemetry data matching new protocol v2.1
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
  
  // Build telemetry message according to new protocol
  const telemetryMessage = {
    event: "telemetry",
    deviceId: config.deviceId,
    telemetry: {
      status: deviceState.status,
      voltageV: deviceState.voltageV,
      currentA: deviceState.currentA,
      powerkWh: deviceState.powerkWh,
      phases: deviceState.phases,
      temperatureC: deviceState.temperatureC,
      updatedAt: new Date().toISOString()
    },
    lastSession: currentSession ? {
      sessionId: currentSession.sessionId,
      sessionStatus: currentSession.sessionStatus,
      sessionUserId: currentSession.sessionUserId,
      startAt: currentSession.startAt,
      endAt: currentSession.endAt,
      energykW: deviceState.energykW,
      rfidId: currentSession.rfidId
    } : null
  };
  
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

function startChargingSession(userId = null, rfidId = null) {
  // Stop any existing session first
  if (currentSession) {
    stopChargingSession();
  }
  
  const now = new Date();
  
  currentSession = {
    sessionId: generateSessionId(),
    sessionStatus: "started",
    sessionUserId: userId, // user who started (null for RFID)
    startAt: now.toISOString(),
    endAt: null,
    energykW: 0, // Session energy starts at 0
    rfidId: rfidId // RFID ID or null for manual
  };
  
  // Add to sessions array
  chargingSessions.push(currentSession);
  
  // Update device state
  deviceState.isCharging = true;
  deviceState.currentRFID = rfidId;
  deviceState.energykW = 0; // Reset session energy counter
  
  console.log(`🔌 Session started: ${currentSession.sessionId} (${rfidId ? 'RFID' : 'Manual'})`);
  
  return currentSession;
  
  // Update device state
  deviceState.isCharging = true;
  deviceState.currentRFID = rfidId;
  deviceState.sessionStartEnergy = deviceState.energyKWh;
  deviceState.startTime = Date.now();
  
  console.log(`🔋 Session started: ${currentSession.sessionId} (${sessionType}${rfidId ? ` - ${rfidId}` : ''})`);
  
  // Broadcast session started event
  broadcastToClients({
    event: 'session_started',
    session: currentSession,
    timestamp: now
  });
  
  return currentSession;
}

function stopChargingSession() {
  if (!currentSession) {
    return null;
  }
  
  const now = new Date();
  
  // Update current session
  currentSession.endAt = now.toISOString();
  currentSession.sessionStatus = "completed";
  // energykW is already tracking session energy in deviceState.energykW
  
  // Update device state
  deviceState.isCharging = false;
  deviceState.currentRFID = null;
  
  console.log(`⏹️  Session completed: ${currentSession.sessionId} | Energy: ${deviceState.energykW.toFixed(3)} kW`);
  
  const completedSession = currentSession;
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
  deviceState.connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
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
    
    // Protocol v2.1 - Handle new format first
    if (command.type) {
      handleProtocolV21Command(ws, command);
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

// Protocol v2.1 command handler
function handleProtocolV21Command(ws, command) {
  let response;
  
  if (command.type === 'config' && command.command === 'network') {
      if (typeof command.data.ssid === 'string' && typeof command.data.password === 'string') {
        // Update network configuration
        networkConfig.ssid = command.data.ssid;
        networkConfig.password = command.data.password;
        networkConfig.local = !!command.data.local;
        networkConfig.mode = 'wifi'; // Switch to wifi mode after configuration
        
        // Persist network configuration
        saveJSON(NETWORK_CONFIG_FILE, networkConfig);
        
        response = {
          type: 'response',
          command: 'network',
          success: true,
          data: {
            ssid: command.data.ssid,
            status: 'configured',
            message: 'Network configuration saved. Device remains connected for simulator testing.'
          },
          timestamp: new Date().toISOString()
        };
        console.log(`📡 Network configured: SSID=${command.data.ssid}, mode=wifi`);
        console.log(`⚠️  NOTE: Simulator does not actually switch networks - it stays at the same IP`);
        console.log(`💡 For testing: Keep your phone on the same network as this PC`);
        
        // Broadcast updated device info to all clients (they stay connected)
        setTimeout(() => {
          const updatedInfo = getDeviceInfo();
          updatedInfo.type = 'event';
          updatedInfo.event = 'network_updated';
          updatedInfo.data = {
            message: 'Network configuration updated. Connection maintained for testing.'
          };
          updatedInfo.timestamp = new Date().toISOString();
          broadcastToClients(updatedInfo);
          console.log(`📡 Broadcasted network update to ${deviceState.connectedClients.size} clients`);
        }, 500);
      } else {
        response = {
          type: 'response',
          command: 'network',
          success: false,
          error: 'Invalid network parameters (ssid and password required)',
          timestamp: new Date().toISOString()
        };
      }
    }
    
    // Legacy protocol support - backwards compatibility
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
      case 'start':
        // New protocol v2.1 - action commands
        if (command.type === 'action' && command.command === 'start_charging') {
          if (!deviceState.isCharging) {
            const session = startChargingSession('manual');
            response = {
              type: 'response',
              command: 'start_charging',
              success: true,
              data: {
                sessionId: session.sessionId,
                startTime: session.startTime,
                message: 'Charging started successfully'
              },
              timestamp: new Date().toISOString()
            };
            console.log('📱 Command: Start charging (v2.1)');
          } else {
            response = {
              type: 'response',
              command: 'start_charging',
              success: false,
              error: 'Device is already charging',
              timestamp: new Date().toISOString()
            };
          }
        }
        // Legacy support
        else if (!deviceState.isCharging) {
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
        // New protocol v2.1 - action commands
        if (command.type === 'action' && command.command === 'stop_charging') {
          if (deviceState.isCharging) {
            const session = stopChargingSession('Manual stop via WebSocket');
            response = {
              type: 'response',
              command: 'stop_charging',
              success: true,
              data: {
                sessionId: session.sessionId,
                endTime: session.endTime,
                energyConsumed: session.energyConsumed,
                duration: session.duration,
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
        }
        // Legacy support
        else if (deviceState.isCharging) {
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
        
      case 'set_limitA':
        if (command.value && command.value >= 6 && command.value <= 16) {
          deviceState.limitA = command.value;
          response = { ack: true, msg: `Limit set to ${command.value}A` };
          console.log(`📱 Command: Set limit to ${command.value}A`);
        } else {
          response = { ack: false, msg: 'Invalid limit (must be 6-16A)' };
        }
        break;
        
      case 'reset_energy':
        deviceState.energyKWh = 0;
        deviceState.sessionStartEnergy = 0;
        response = { ack: true, msg: 'Energy counter reset' };
        console.log('📱 Command: Reset energy counter');
        break;
        
      // RFID Commands - New Protocol v2.1
      case 'add_rfid':
        if (command.type === 'config' && command.command === 'add_rfid') {
          if (command.data && command.data.id) {
            const result = addRFID({
              id: command.data.id,
              userId: command.data.userId || 'unknown',
              label: command.data.label || 'Unnamed RFID'
            });
            response = {
              type: 'response',
              command: 'add_rfid',
              success: result.success,
              data: result.success ? {
                id: command.data.id,
                message: result.msg
              } : null,
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
        }
        // Legacy support
        else if (command.rfid && command.rfid.rfidId) {
          const result = addRFID(command.rfid);
          response = { 
            ack: result.success, 
            msg: result.msg,
            rfidId: command.rfid.rfidId 
          };
        } else {
          response = { ack: false, msg: 'Invalid RFID data' };
        }
        break;
        
      case 'delete_rfid':
        if (command.type === 'config' && command.command === 'delete_rfid') {
          if (command.data && command.data.id) {
            const result = deleteRFID(command.data.id);
            response = {
              type: 'response',
              command: 'delete_rfid',
              success: result.success,
              data: result.success ? {
                id: command.data.id,
                message: result.msg
              } : null,
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
        }
        // Legacy support
        else if (command.rfidId) {
          const result = deleteRFID(command.rfidId);
          response = { 
            ack: result.success, 
            msg: result.msg,
            rfidId: command.rfidId 
          };
        } else {
          response = { ack: false, msg: 'RFID ID required' };
        }
        break;
        
      case 'list_rfids':
        // Send detailed RFID list as separate event
        const rfidListEvent = {
          event: 'rfid_list',
          rfids: rfids,
          count: rfids.length,
          currentRFID: deviceState.currentRFID,
          charging: deviceState.isCharging,
          timestamp: Math.floor(Date.now() / 1000)
        };
        ws.send(JSON.stringify(rfidListEvent));
        response = { ack: true, msg: `Sent ${rfids.length} RFIDs` };
        break;

      // Session Management Commands
      case 'get_sessions':
        const limit = command.limit || 50;
        const sessionHistoryEvent = {
          event: 'session_history',
          sessions: getSessionHistory(limit),
          activeSession: getActiveSession(),
          totalSessions: chargingSessions.length,
          timestamp: Math.floor(Date.now() / 1000)
        };
        ws.send(JSON.stringify(sessionHistoryEvent));
        response = { ack: true, msg: `Sent ${chargingSessions.length} sessions` };
        break;

      case 'get_unsynced_sessions':
        const unsynced = chargingSessions.filter(s => s.unsynced === true);
        ws.send(JSON.stringify({
          event: 'unsynced_sessions',
          sessions: unsynced,
          count: unsynced.length,
          timestamp: Math.floor(Date.now() / 1000)
        }));
        response = { ack: true, msg: `Sent ${unsynced.length} unsynced sessions` };
        break;

      case 'ack_sessions_synced':
        if (Array.isArray(command.sessionIds)) {
          let updated = 0;
          chargingSessions.forEach(s => {
            if (command.sessionIds.includes(s.sessionId)) {
              if (s.unsynced) { s.unsynced = false; updated++; }
            }
          });
          saveJSON(SESSIONS_FILE, chargingSessions);
          response = { ack: true, msg: `Acknowledged ${updated} sessions` };
        } else {
          response = { ack: false, msg: 'sessionIds array required' };
        }
        break;

      case 'get_active_session':
        const activeSession = getActiveSession();
        if (activeSession) {
          ws.send(JSON.stringify({
            event: 'active_session',
            session: activeSession,
            timestamp: Math.floor(Date.now() / 1000)
          }));
          response = { ack: true, msg: 'Active session sent' };
        } else {
          response = { ack: false, msg: 'No active session' };
        }
        break;

      // RFID Tap Simulation
      case 'tap_rfid':
        // New protocol v2.1 - RFID tap event
        if (command.type === 'event' && command.event === 'rfid_tap') {
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
        }
        // Legacy support
        else if (command.rfidId) {
          const tapResult = tapRFID(command.rfidId);
          response = {
            ack: tapResult.success,
            msg: tapResult.msg,
            rfidId: command.rfidId,
            session: tapResult.session || null
          };
        } else {
          response = { ack: false, msg: 'RFID ID required' };
        }
        break;
        
      case 'sync_rfids':
      case 'set_rfids':
        // Bulk sync RFIDs from Firestore/App
        {
          const incomingRFIDs = (command.rfids && Array.isArray(command.rfids))
            ? command.rfids
            : (command.data && Array.isArray(command.data.rfids))
              ? command.data.rfids
              : null;
          if (!incomingRFIDs) {
            response = { ack: false, msg: 'Invalid RFID array for sync (expected rfids[] or data.rfids[])' };
            break;
          }
          const result = syncRFIDs(incomingRFIDs);
          response = { 
            ack: result.success, 
            msg: result.msg,
            count: rfids.length,
            rfids: rfids.map(r => `${r.rfidId} (${r.label})`)
          };
          console.log(`📱 Command: Sync ${rfids.length} RFIDs from Flutter app`);
          
          // Broadcast RFID list update to all clients (including dashboard)
          if (result.success) {
            broadcastToClients({
              event: 'rfid_list',
              rfids: rfids,
              count: rfids.length,
              timestamp: Math.floor(Date.now() / 1000)
            });
          }
        }
        break;
        
      case 'get_rfids':
        // Get all RFIDs
        response = {
          ack: true,
          msg: 'RFID list',
          rfids: rfids,
          count: rfids.length
        };
        console.log(`📱 Command: Get ${rfids.length} RFIDs`);
        break;
        
      case 'get_status':
        // Get detailed device status including RFIDs
        response = {
          ack: true,
          msg: 'Device status',
          status: {
            deviceId: config.deviceId,
            charging: deviceState.isCharging,
            energyKWh: deviceState.energyKWh,
            currentRFID: deviceState.currentRFID,
            connectedClients: deviceState.connectedClients.size,
            rfidCount: rfids.length,
            rfids: rfids,
            timestamp: Math.floor(Date.now() / 1000)
          }
        };
        break;
        
      default:
        response = { ack: false, msg: `Unknown action: ${action}` };
    }
    
    ws.send(JSON.stringify(response));
    
    // Broadcast updated telemetry after command to reflect any state changes
    setTimeout(() => {
      broadcastToClients(generateTelemetry());
    }, 50);
    
  } catch (error) {
    console.error('❌ Error parsing command:', error.message);
    ws.send(JSON.stringify({ ack: false, msg: 'Invalid JSON command' }));
  }
}

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
    }
    console.log(`🌐 HTTP Server: http://${deviceIP}:${config.httpPort}`);

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

    app.listen(config.httpPort, () => {
      console.log(`🌐 HTTP API available at: http://${deviceIP}:${config.httpPort}`);
    });

    // mDNS advertisement (works in both hotspot and Wi-Fi modes)
    let mdnsService = null;
    try {
      const uniqueName = `wisecharger-mock-${Date.now()}`;
      mdnsService = bonjour.publish({
        name: uniqueName,
        type: config.serviceName,
        port: config.port,
        txt: {
          deviceId: config.deviceId,
          model: 'WiseCharger Pro AC22',
          firmware: 'v2.1.4',
          serial: 'WC-MOCK-123456',
          rfidSupported: 'true',
          mode: networkConfig.mode,
          ip: deviceIP
        }
      });
      
      console.log(`📻 mDNS Service: ${uniqueName}.local:${config.port}`);
      console.log(`📋 Service Type: ${config.serviceName}`);
      if (isHotspotMode) {
        console.log(`ℹ️  In AP mode - mDNS available, fixed IP: ${deviceIP}`);
      } else {
        console.log(`ℹ️  In Wi-Fi mode - mDNS broadcasting device info`);
      }
    } catch (error) {
      console.log('⚠️  mDNS service failed to start:', error.message);
      console.log(`📡 Server still available via direct connection: ws://${deviceIP}:${config.port}`);
    }

    // WebSocket connection handling
    wss.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      console.log(`🔗 New client connected from ${clientIP}`);
      
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
        } else {
          clearInterval(telemetryInterval);
        }
      }, 5000);
      
      // Handle incoming messages
      ws.on('message', (message) => {
        console.log(`📨 Received: ${message}`);
        handleCommand(ws, message);
      });
      
      // Handle disconnection
      ws.on('close', () => {
        console.log(`🔌 Client disconnected from ${clientIP}`);
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
      console.log(`📊 Status: ${status} | Clients: ${clients} | Energy: ${deviceState.energyKWh.toFixed(2)} kWh${rfidInfo}`);
    }, 30000);

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