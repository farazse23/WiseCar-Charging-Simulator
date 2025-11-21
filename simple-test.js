#!/usr/bin/env node

/**
 * Simple Protocol v2.1 Connection Test
 * Tests basic connectivity and message format
 */

const WebSocket = require('ws');

async function testConnection() {
  console.log('🧪 Testing WiseCar Protocol v2.1...');
  
  // Try multiple connection options
  const urls = [
    'ws://localhost:3000',
    'ws://127.0.0.1:3000',
    'ws://192.168.1.10:3000'
  ];
  
  for (const url of urls) {
    console.log(`📡 Trying to connect to: ${url}`);
    
    try {
      const ws = new WebSocket(url, { timeout: 5000 });
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);
        
        ws.on('open', () => {
          clearTimeout(timeout);
          console.log('✅ Connected successfully!');
          
          // Test new protocol v2.1 message
          const testMessage = {
            type: 'config',
            command: 'add_rfid',
            data: {
              id: 'TEST123',
              userId: 'testuser'
            },
            timestamp: new Date().toISOString()
          };
          
          console.log('📤 Sending test message:', JSON.stringify(testMessage, null, 2));
          ws.send(JSON.stringify(testMessage));
          
          setTimeout(() => {
            ws.close();
            resolve();
          }, 2000);
        });
        
        ws.on('message', (data) => {
          console.log('📨 Received response:', JSON.parse(data.toString()));
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      
      console.log('✅ Test completed successfully!');
      return;
      
    } catch (error) {
      console.log(`❌ Failed to connect to ${url}: ${error.message}`);
    }
  }
  
  console.log('❌ All connections failed. Please check if the server is running.');
}

testConnection().catch(console.error);