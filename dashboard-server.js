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
  
  Promise.all([
    checkPort(3000), // Wi-Fi mode
    checkPort(3001)  // Hotspot mode
  ]).then(([wifiRunning, hotspotRunning]) => {
    res.json({
      wifiMode: {
        running: wifiRunning,
        port: 3000,
        url: `ws://localhost:3000`
      },
      hotspotMode: {
        running: hotspotRunning,
        port: 3001,
        url: `ws://localhost:3001`
      },
      timestamp: Date.now()
    });
  });
});

app.listen(dashboardPort, () => {
  console.log(`🎛️  WiseCar Dashboard available at: http://localhost:${dashboardPort}`);
  console.log(`📊 Use this interface to monitor and test your charger simulator`);
});

module.exports = app;