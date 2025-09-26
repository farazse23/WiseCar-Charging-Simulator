#!/usr/bin/env node

/**
 * Simple WebSocket test client for WiseCar Charger Simulator
 * Usage: node test-client.js [ws://ip:port]
 */

const WebSocket = require('ws');

const serverUrl = process.argv[2] || 'ws://localhost:3000';

console.log('🔌 WiseCar Test Client');
console.log(`📡 Connecting to: ${serverUrl}`);

const ws = new WebSocket(serverUrl);

ws.on('open', function() {
  console.log('✅ Connected to simulator');
  
  // Test sequence
  setTimeout(() => {
    console.log('📤 Sending: Start charging');
    ws.send(JSON.stringify({ action: 'start' }));
  }, 2000);
  
  setTimeout(() => {
    console.log('📤 Sending: Set limit to 12A');
    ws.send(JSON.stringify({ action: 'set_limitA', value: 12 }));
  }, 5000);
  
  setTimeout(() => {
    console.log('📤 Sending: Stop charging');
    ws.send(JSON.stringify({ action: 'stop' }));
  }, 15000);
  
  setTimeout(() => {
    console.log('📤 Sending: Reset energy');
    ws.send(JSON.stringify({ action: 'reset_energy' }));
  }, 18000);
  
  // Close after 25 seconds
  setTimeout(() => {
    console.log('👋 Closing connection');
    ws.close();
  }, 25000);
});

ws.on('message', function(data) {
  try {
    const message = JSON.parse(data);
    
    if (message.event === 'hello') {
      console.log('👋 Handshake received:');
      console.log(`   Device: ${message.displayName} (${message.deviceId})`);
      console.log(`   Model: ${message.info.model}`);
      console.log(`   Firmware: ${message.info.firmware}`);
      console.log(`   Network: ${message.network.mode} (${message.network.lastIp})`);
    } else if (message.event === 'telemetry') {
      const tel = message.telemetry;
      console.log(`📊 Telemetry: ${tel.status} | ${tel.voltage}V | ${tel.currentA}A | ${tel.energyKWh}kWh | ${tel.temperatureC}°C`);
    } else if (message.ack !== undefined) {
      console.log(`📨 Response: ${message.ack ? '✅' : '❌'} ${message.msg}`);
    }
  } catch (error) {
    console.log('📨 Raw message:', data.toString());
  }
});

ws.on('error', function(error) {
  console.error('❌ Connection error:', error.message);
});

ws.on('close', function() {
  console.log('🔌 Connection closed');
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', function() {
  console.log('\n👋 Closing test client...');
  ws.close();
});