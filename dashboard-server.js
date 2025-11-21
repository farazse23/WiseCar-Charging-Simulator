const express = require('express');
const path = require('path');
const fs = require('fs');

// Simple Express server to serve the dashboard
const app = express();
const dashboardPort = 8080;

// Serve static files
app.use(express.static(__dirname));

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API route to get server status
app.get('/api/status', (req, res) => {
  // Check if server.js is running by trying to connect
  const net = require('net');
  
  const checkPort = (port) => {
    return new Promise((resolve) => {
      const client = net.createConnection({ port, host: 'localhost' }, () => {
        client.end();
        resolve(true);
      });
      
      client.on('error', () => {
        resolve(false);
      });
    });
  };
  
  // Always use hotspot mode (config persistence disabled for testing)
  let networkConfig = { mode: 'hotspot', ssid: null, password: null };
  // DISABLED: Reading saved network config
  // try {
  //   if (fs.existsSync(path.join(__dirname, 'network-config.json'))) {
  //     const configData = fs.readFileSync(path.join(__dirname, 'network-config.json'), 'utf-8');
  //     networkConfig = JSON.parse(configData);
  //   }
  // } catch (error) {
  //   console.log('Could not read network config:', error.message);
  // }
  
  // Always use hotspot mode IP
  const deviceIP = '192.168.1.10';
  const wsPort = 3000;
  const httpPort = 3002;
  
  checkPort(wsPort).then(running => {
    res.json({
      running: running,
      networkConfig: networkConfig,
      deviceIP: deviceIP,
      wsPort: wsPort,
      httpPort: httpPort,
      wsUrl: `ws://${deviceIP}:${wsPort}`,
      httpUrl: `http://${deviceIP}:${httpPort}`,
      isHotspot: networkConfig.mode === 'hotspot',
      timestamp: Date.now()
    });
  });
});

app.listen(dashboardPort, () => {
  console.log(`🎛️  WiseCar Dashboard available at: http://localhost:${dashboardPort}`);
  console.log(`📊 Use this interface to monitor and test your charger simulator`);
});

module.exports = app;