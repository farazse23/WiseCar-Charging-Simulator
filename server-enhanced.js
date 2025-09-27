const WebSocket = require('ws');
const express = require('express');
const bonjour = require('bonjour')();
const os = require('os');
const net = require('net');

// Configuration
const config = {
  port: process.env.PORT || 3000,
  httpPort: process.env.HTTP_PORT || 3002,
  deviceId: 'device_mock_001',
  serviceName: '_wisecar._tcp.local'
};

// Device state with RFID support
let deviceState = {
  isCharging: false,
  energyKWh: 0,
  limitA: 16,
  startTime: null,
  connectedClients: new Set(),
  currentRFID: null,      // Currently active RFID session
  sessionStartEnergy: 0   // Energy at session start (legacy)
};

// Session management
let chargingSessions = []; // Store all sessions (completed and active)
let currentSession = null; // Active session object

// Session structure:
// {
//   sessionId: "session_123456789",
//   rfidId: "RFID#123456" | null, // null for manual sessions
//   startTime: 1727414000,
//   endTime: 1727416800 | null,   // null for active sessions
//   startEnergyKWh: 0,
//   endEnergyKWh: 4.2,
//   durationSeconds: 2800,
//   status: "active" | "completed",
//   deviceId: "device_mock_001",
//   sessionType: "rfid" | "manual"
// }

// In-memory RFIDs array (matches Firestore structure)
// NOTE: This starts empty - RFIDs should be synced from Flutter app/Firestore
let rfids = [
  // Example structure (remove in production):
  // {
  //   rfidId: "RFID#123456",
  //   label: "Dad Card", 
  //   ownerUid: "ABC12345",
  //   ownerName: "Ali",
  //   createdAt: 1758890000
  // }
];

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

const localIP = getLocalIP();

// Device information including RFIDs (matching Firestore schema)
function getDeviceInfo() {
  const now = Math.floor(Date.now() / 1000);
  return {
    event: 'hello',
    deviceId: config.deviceId,
    displayName: 'Simulator Charger',
    info: {
      firmware: 'v2.1.4',
      model: 'WiseCharger Pro AC22',
      phases: 1,
      rfidSupported: true,
      serial: 'WC-MOCK-123456'
    },
    warranty: {
      start: now - 86400, // 1 day ago
      end: now + (365 * 24 * 60 * 60) // 1 year from now
    },
    network: {
      lastIp: localIP,
      mode: 'wifi'
    },
    settings: {
      appNotifications: true,
      autoPlug: true,
      costPerKWh: 0,
      deviceNotifications: false,
      fastCharging: true,
      language: 'en',
      limitA: deviceState.limitA
    },
    rfids: rfids // Include RFIDs in handshake
  };
}

// Generate realistic telemetry data
function generateTelemetry() {
  const now = Math.floor(Date.now() / 1000);
  
  // Simulate charging behavior
  let voltage = 220 + Math.random() * 20; // 220-240V
  let currentA = 0;
  
  // Determine connection status based on active WebSocket connections
  let status = 'disconnected';
  if (deviceState.connectedClients.size > 0) {
    status = deviceState.isCharging ? 'charging' : 'connected';
  }
  
  if (deviceState.isCharging) {
    currentA = Math.min(deviceState.limitA * (0.8 + Math.random() * 0.2), 16); // 80-100% of limit, max 16A
    
    // Increase energy gradually (5 seconds = 1/720 hour at full power)
    deviceState.energyKWh += (currentA * voltage / 1000) * (5 / 3600); // kWh increment for 5 seconds
  }
  
  const temperature = 30 + Math.random() * 20 + (deviceState.isCharging ? 5 : 0); // 30-50°C, higher when charging
  
  return {
    event: 'telemetry',
    deviceId: config.deviceId,
    telemetry: {
      status: status,
      voltage: Math.round(voltage * 10) / 10,
      currentA: Math.round(currentA * 10) / 10,
      energyKWh: Math.round(deviceState.energyKWh * 100) / 100,
      temperatureC: Math.round(temperature * 10) / 10,
      phases: 1,
      connectedClients: deviceState.connectedClients.size,
      updatedAt: now,
      currentRFID: deviceState.currentRFID, // Include active RFID in telemetry
      activeSession: currentSession ? {
        sessionId: currentSession.sessionId,
        startTime: currentSession.startTime,
        duration: now - currentSession.startTime,
        sessionEnergy: Math.round((deviceState.energyKWh - currentSession.startEnergyKWh) * 100) / 100
      } : null
    }
  };
}

// RFID helper functions
function findRFID(rfidId) {
  return rfids.find(rfid => rfid.rfidId === rfidId);
}

function addRFID(rfidData) {
  // Check if RFID already exists
  const existing = findRFID(rfidData.rfidId);
  if (existing) {
    return { success: false, msg: 'RFID already exists' };
  }
  
  // Add timestamp if not provided
  if (!rfidData.createdAt) {
    rfidData.createdAt = Math.floor(Date.now() / 1000);
  }
  
  rfids.push(rfidData);
  console.log(`📋 RFID added: ${rfidData.rfidId} (${rfidData.label})`);
  return { success: true, msg: 'RFID added successfully' };
}

function tapRFID(rfidId) {
  const rfid = findRFID(rfidId);
  if (!rfid) {
    return { success: false, msg: `RFID ${rfidId} not found in authorized list` };
  }

  // Check if this RFID is currently charging
  if (deviceState.isCharging && deviceState.currentRFID === rfidId) {
    // Stop charging session
    const session = stopChargingSession('RFID tap stop');
    return { 
      success: true, 
      msg: `Charging stopped for ${rfid.label}`,
      session: session
    };
  } else if (!deviceState.isCharging) {
    // Start new charging session
    const session = startChargingSession('rfid', rfidId);
    return { 
      success: true, 
      msg: `Charging started for ${rfid.label}`,
      session: session
    };
  } else {
    // Different RFID tapped while charging
    const currentRfid = findRFID(deviceState.currentRFID);
    return { 
      success: false, 
      msg: `Cannot tap ${rfid.label} - ${currentRfid?.label || 'Unknown'} is currently charging` 
    };
  }
}

function deleteRFID(rfidId) {
  const index = rfids.findIndex(rfid => rfid.rfidId === rfidId);
  if (index === -1) {
    return { success: false, msg: 'RFID not found' };
  }
  
  // Stop charging session if this RFID is currently active
  if (deviceState.currentRFID === rfidId) {
    stopChargingSession('RFID deleted');
  }
  
  const deletedRFID = rfids.splice(index, 1)[0];
  console.log(`�️  RFID deleted: ${rfidId} (${deletedRFID.label})`);
  return { success: true, msg: 'RFID deleted successfully' };
}

// Sync RFIDs from Firestore/App (replaces entire RFID array)
function syncRFIDs(newRFIDs) {
  if (!Array.isArray(newRFIDs)) {
    return { success: false, msg: 'Invalid RFID array' };
  }
  
  // Convert and validate RFID data
  const processedRFIDs = [];
  
  for (let i = 0; i < newRFIDs.length; i++) {
    const rfidData = newRFIDs[i];
    let processedRFID;
    
    if (typeof rfidData === 'string') {
      // Handle simple string format from Flutter app
      processedRFID = {
        rfidId: rfidData,
        label: `Card ${i + 1}`,
        ownerUid: 'unknown',
        ownerName: 'Unknown User',
        createdAt: Math.floor(Date.now() / 1000)
      };
    } else if (typeof rfidData === 'object' && rfidData.rfidId) {
      // Handle full object format
      processedRFID = {
        rfidId: rfidData.rfidId,
        label: rfidData.label || `Card ${i + 1}`,
        ownerUid: rfidData.ownerUid || 'unknown',
        ownerName: rfidData.ownerName || 'Unknown User',
        createdAt: rfidData.createdAt || Math.floor(Date.now() / 1000)
      };
    } else {
      console.log(`⚠️  Invalid RFID format at index ${i}:`, rfidData);
      continue; // Skip invalid entries
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
  console.log(`📋 RFIDs synced from app: ${rfids.length} RFIDs`);
  
  // Log each RFID for debugging
  rfids.forEach((rfid, index) => {
    console.log(`   ${index + 1}. ${rfid.rfidId} (${rfid.label})`);
  });
  
  return { success: true, msg: `Synced ${rfids.length} RFIDs successfully` };
}

// Session Management Functions
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function startChargingSession(sessionType, rfidId = null) {
  // Stop any existing session first
  if (currentSession) {
    stopChargingSession('New session started');
  }
  
  const now = Math.floor(Date.now() / 1000);
  currentSession = {
    sessionId: generateSessionId(),
    rfidId: rfidId,
    startTime: now,
    endTime: null,
    startEnergyKWh: deviceState.energyKWh,
    endEnergyKWh: null,
    durationSeconds: null,
    status: "active",
    deviceId: config.deviceId,
    sessionType: sessionType // "rfid" or "manual"
  };
  
  // Add to sessions array
  chargingSessions.push(currentSession);
  
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

function stopChargingSession(reason = 'Manual stop') {
  if (!currentSession) {
    return null;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const sessionEnergy = deviceState.energyKWh - currentSession.startEnergyKWh;
  
  // Update session
  currentSession.endTime = now;
  currentSession.endEnergyKWh = deviceState.energyKWh;
  currentSession.durationSeconds = now - currentSession.startTime;
  currentSession.status = "completed";
  
  // Update device state
  deviceState.isCharging = false;
  deviceState.currentRFID = null;
  deviceState.startTime = null;
  
  console.log(`⏹️  Session completed: ${currentSession.sessionId}`);
  console.log(`   Duration: ${currentSession.durationSeconds}s | Energy: ${sessionEnergy.toFixed(2)} kWh | Reason: ${reason}`);
  
  // Broadcast session completed event
  broadcastToClients({
    event: 'session_completed',
    session: currentSession,
    reason: reason,
    timestamp: now
  });
  
  // Auto-disconnect clients when charging stops (simulates real device behavior)
  if (reason.includes('Manual stop') || reason.includes('RFID tap stop')) {
    console.log('🔌 Auto-disconnecting clients after charging stop...');
    setTimeout(() => {
      disconnectAllClients('Charging session ended');
    }, 2000); // 2 second delay to allow final messages to be sent
  }
  
  const completedSession = currentSession;
  currentSession = null;
  
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

// Handle client commands
function handleCommand(ws, message) {
  try {
    const command = JSON.parse(message);
    let response = { ack: false, msg: 'Unknown command' };
    
    // Support both 'action' and 'command' fields for compatibility
    const action = command.action || command.command;
    
    switch (action) {
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
        
      // RFID Commands
      case 'add_rfid':
        if (command.rfid && command.rfid.rfidId) {
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
        if (command.rfidId) {
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
        if (command.rfidId) {
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
        response = { 
          ack: true, 
          msg: `RFID list sent (${rfids.length} RFIDs stored)`,
          count: rfids.length 
        };
        break;
        
      case 'sync_rfids':
      case 'set_rfids':
        // Bulk sync RFIDs from Firestore/App
        if (command.rfids && Array.isArray(command.rfids)) {
          const result = syncRFIDs(command.rfids);
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
        } else {
          response = { ack: false, msg: 'Invalid RFID array for sync' };
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
    // Find available ports
    const availableWSPort = await findAvailablePort(config.port);
    const availableHTTPPort = await findAvailablePort(config.httpPort);
    config.port = availableWSPort;
    config.httpPort = availableHTTPPort;

    console.log('🔌 WiseCar Charger Simulator with RFID Support Starting...');
    console.log(`📡 Mode: Wi-Fi`);
    console.log(`🌐 WebSocket Server: ws://${localIP}:${config.port}`);
    console.log(`🔍 Also available on: ws://localhost:${config.port}`);
    console.log(`🌐 HTTP Server: http://${localIP}:${config.httpPort}`);

    // Create WebSocket server
    const wss = new WebSocket.Server({ 
      port: config.port,
      host: '0.0.0.0'
    });

    // Create HTTP server for RFID simulation endpoints
    const app = express();
    app.use(express.json());

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
      console.log(`🌐 HTTP API available at: http://localhost:${config.httpPort}`);
    });

    // mDNS advertisement for Wi-Fi mode
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
          rfidSupported: 'true'
        }
      });
      
      console.log(`📻 mDNS Service: ${uniqueName}.local:${config.port}`);
      console.log(`📋 Service Type: ${config.serviceName}`);
    } catch (error) {
      console.log('⚠️  mDNS service failed to start:', error.message);
      console.log('📡 Server still available via direct IP connection');
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