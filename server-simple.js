const WebSocket = require('ws');
const bonjour = require('bonjour')();
const os = require('os');
const net = require('net');

    // Configuration
const config = {
  port: process.env.PORT || 3000,
  deviceId: 'device_mock_001',
  serviceName: '_wisecar._tcp.local'
};// Device state
let deviceState = {
  isCharging: false,
  energyKWh: 0,
  limitA: 16,
  startTime: null,
  connectedClients: new Set()
};

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

// Device information matching Firestore schema
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
    }
  };
}

// Generate realistic telemetry data
function generateTelemetry() {
  const now = Math.floor(Date.now() / 1000);
  
  // Simulate charging behavior
  let voltage = 220 + Math.random() * 20; // 220-240V
  let currentA = 0;
  let status = 'connected';
  
  if (deviceState.isCharging) {
    status = 'charging';
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
      updatedAt: now
    }
  };
}

// Handle client commands
function handleCommand(ws, message) {
  try {
    const command = JSON.parse(message);
    let response = { ack: false, msg: 'Unknown command' };
    
    switch (command.action) {
      case 'start':
        if (!deviceState.isCharging) {
          deviceState.isCharging = true;
          deviceState.startTime = Date.now();
          response = { ack: true, msg: 'Charging started' };
          console.log('📱 Command: Start charging');
        } else {
          response = { ack: false, msg: 'Already charging' };
        }
        break;
        
      case 'stop':
        if (deviceState.isCharging) {
          deviceState.isCharging = false;
          deviceState.startTime = null;
          response = { ack: true, msg: 'Charging stopped' };
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
        response = { ack: true, msg: 'Energy counter reset' };
        console.log('📱 Command: Reset energy counter');
        break;
        
      default:
        response = { ack: false, msg: `Unknown action: ${command.action}` };
    }
    
    ws.send(JSON.stringify(response));
  } catch (error) {
    console.error('❌ Error parsing command:', error.message);
    ws.send(JSON.stringify({ ack: false, msg: 'Invalid JSON command' }));
  }
}

// Main startup
async function startServer() {
  try {
    // Find available port
    const availablePort = await findAvailablePort(config.port);
    config.port = availablePort;

    console.log('🔌 WiseCar Charger Simulator Starting...');
    console.log(`📡 Mode: Wi-Fi`);
    console.log(`🌐 WebSocket Server: ws://${localIP}:${config.port}`);
    console.log(`🔍 Also available on: ws://localhost:${config.port}`);

    // Create WebSocket server
    const wss = new WebSocket.Server({ 
      port: config.port,
      host: '0.0.0.0'
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
          serial: 'WC-MOCK-123456'
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
      
      // Send handshake immediately
      const handshake = getDeviceInfo();
      ws.send(JSON.stringify(handshake));
      console.log('👋 Sent handshake to client');
      
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
      console.log(`📊 Status: ${status} | Clients: ${clients} | Energy: ${deviceState.energyKWh.toFixed(2)} kWh`);
    }, 30000);

    console.log('✅ WiseCar Charger Simulator ready for connections!');
    console.log('💡 Usage:');
    console.log('   - Connect WebSocket client to receive telemetry');
    console.log('   - Send commands: {"action": "start"}, {"action": "stop"}, {"action": "set_limitA", "value": 10}');
    console.log('   - Press Ctrl+C to stop');

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();