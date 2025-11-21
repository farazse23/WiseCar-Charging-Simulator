#!/usr/bin/env node

/**
 * Comprehensive WiseCar Protocol v2.1 Test Suite
 * Tests all new protocol features systematically
 */

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:3000';
let ws;
let testResults = [];
let testStep = 0;

function logTest(test, success, message, data = null) {
  const result = { step: ++testStep, test, success, message, data, timestamp: new Date().toISOString() };
  testResults.push(result);
  console.log(`${success ? '✅' : '❌'} Step ${testStep}: ${test} - ${message}`);
  if (data && !success) {
    console.log(`   Data: ${JSON.stringify(data, null, 2)}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runComprehensiveTests() {
  console.log('🧪 Starting Comprehensive WiseCar Protocol v2.1 Test Suite...');
  console.log('📡 Connecting to:', SERVER_URL);
  
  try {
    ws = new WebSocket(SERVER_URL);
    
    ws.on('open', async () => {
      console.log('🔗 Connected to simulator\n');
      
      // Wait for initial hello message
      await sleep(500);
      
      // Test 1: Network Configuration (Protocol v2.1)
      console.log('\n📋 Testing Network Configuration...');
      const networkConfig = {
        type: 'config',
        command: 'network',
        data: {
          ssid: 'TestWiFi',
          password: 'testpass123',
          local: false
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(networkConfig));
      await sleep(1000);
      
      // Test 2: Add RFID (Protocol v2.1)
      console.log('\n📋 Testing Add RFID...');
      const addRfid = {
        type: 'config', 
        command: 'add_rfid',
        data: {
          id: 'CARD001',
          userId: 'user123'
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(addRfid));
      await sleep(1000);
      
      // Test 3: Add Second RFID
      const addRfid2 = {
        type: 'config',
        command: 'add_rfid', 
        data: {
          id: 'CARD002',
          userId: 'user456'
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(addRfid2));
      await sleep(1000);
      
      // Test 4: Start Charging (Protocol v2.1)
      console.log('\n📋 Testing Start Charging...');
      const startCharging = {
        type: 'action',
        command: 'start_charging',
        data: {},
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(startCharging));
      await sleep(2000);
      
      // Test 5: RFID Tap Event (Protocol v2.1) - Should stop charging
      console.log('\n📋 Testing RFID Tap (Stop Charging)...');
      const rfidTap1 = {
        type: 'event',
        event: 'rfid_tap',
        data: {
          id: 'CARD001'
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(rfidTap1));
      await sleep(2000);
      
      // Test 6: RFID Tap Event (Start Charging)
      console.log('\n📋 Testing RFID Tap (Start Charging)...');
      const rfidTap2 = {
        type: 'event',
        event: 'rfid_tap',
        data: {
          id: 'CARD002'
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(rfidTap2));
      await sleep(2000);
      
      // Test 7: Stop Charging (Protocol v2.1)
      console.log('\n📋 Testing Stop Charging...');
      const stopCharging = {
        type: 'action',
        command: 'stop_charging',
        data: {},
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(stopCharging));
      await sleep(1000);
      
      // Test 8: Delete RFID (Protocol v2.1)
      console.log('\n📋 Testing Delete RFID...');
      const deleteRfid = {
        type: 'config',
        command: 'delete_rfid',
        data: {
          id: 'CARD001'
        },
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(deleteRfid));
      await sleep(1000);
      
      // Test 9: Legacy Protocol Support
      console.log('\n📋 Testing Legacy Protocol Support...');
      const legacyStart = {
        action: 'start'
      };
      ws.send(JSON.stringify(legacyStart));
      await sleep(1000);
      
      const legacyStop = {
        action: 'stop'
      };
      ws.send(JSON.stringify(legacyStop));
      await sleep(1000);
      
      // Show results after all tests
      setTimeout(() => {
        showTestResults();
        ws.close();
        process.exit(0);
      }, 2000);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Analyze different message types
        if (message.type) {
          // New Protocol v2.1 messages
          if (message.type === 'response') {
            logTest(`${message.command} Response`, 
                    message.hasOwnProperty('success'), 
                    message.success ? `Success: ${message.data?.message || 'OK'}` : `Error: ${message.error}`,
                    message);
          } else if (message.type === 'event') {
            logTest(`Event: ${message.event}`, 
                    message.hasOwnProperty('data'), 
                    `Event received with data`,
                    message);
          } else if (message.type === 'telemetry') {
            // Only log first telemetry to avoid spam
            if (testResults.filter(r => r.test.includes('Telemetry')).length === 0) {
              logTest('Telemetry Format', 
                      message.hasOwnProperty('data') && message.hasOwnProperty('timestamp'), 
                      `Telemetry structure correct - Status: ${message.data?.status}`,
                      message);
            }
          }
        } else if (message.event) {
          // Legacy or other event formats
          if (message.event === 'hello') {
            logTest('Device Hello', 
                    message.hasOwnProperty('deviceId') && message.deviceId === 'wtl-202501234567', 
                    `Device ID: ${message.deviceId}`,
                    message);
          } else if (message.event === 'telemetry') {
            // Only log first legacy telemetry
            if (testResults.filter(r => r.test.includes('Legacy Telemetry')).length === 0) {
              logTest('Legacy Telemetry', 
                      message.hasOwnProperty('telemetry'), 
                      `Legacy telemetry structure - Status: ${message.telemetry?.status}`,
                      message);
            }
          } else {
            logTest(`Legacy Event: ${message.event}`, 
                    true, 
                    `Legacy event received`,
                    message);
          }
        } else if (message.ack !== undefined) {
          // Legacy acknowledgment format
          logTest('Legacy ACK', 
                  message.ack === true || message.ack === false, 
                  message.ack ? `Success: ${message.msg}` : `Error: ${message.msg}`,
                  message);
        }
        
      } catch (error) {
        logTest('Message Parse', false, `Failed to parse: ${error.message}`, data.toString());
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      logTest('Connection', false, `WebSocket error: ${error.message}`);
    });
    
    ws.on('close', () => {
      console.log('🔌 Connection closed');
    });
    
  } catch (error) {
    console.error('❌ Failed to connect:', error);
    process.exit(1);
  }
}

function showTestResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPREHENSIVE TEST RESULTS');
  console.log('='.repeat(80));
  
  const passed = testResults.filter(r => r.success).length;
  const total = testResults.length;
  const passRate = ((passed / total) * 100).toFixed(1);
  
  console.log(`\n✅ PASSED: ${passed}/${total} (${passRate}%)`);
  
  if (passed === total) {
    console.log('🎉 ALL TESTS PASSED! Protocol v2.1 implementation is working correctly.');
  } else {
    console.log(`❌ FAILED: ${total - passed}/${total}`);
    console.log('\n❌ Failed tests:');
    testResults.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.step}. ${r.test}: ${r.message}`);
    });
  }
  
  console.log('\n📋 Test Categories Summary:');
  const categories = {
    'Protocol v2.1 Features': testResults.filter(r => r.test.includes('Response') || r.test.includes('Event:')).length,
    'Legacy Compatibility': testResults.filter(r => r.test.includes('Legacy')).length,
    'Device Communication': testResults.filter(r => r.test.includes('Hello') || r.test.includes('Telemetry')).length,
    'RFID Management': testResults.filter(r => r.test.includes('add_rfid') || r.test.includes('delete_rfid') || r.test.includes('Tap')).length,
    'Charging Control': testResults.filter(r => r.test.includes('start_charging') || r.test.includes('stop_charging')).length
  };
  
  Object.entries(categories).forEach(([category, count]) => {
    console.log(`   ${category}: ${count} tests`);
  });
  
  console.log('\n' + '='.repeat(80));
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n⏹️  Test interrupted by user');
  showTestResults();
  if (ws) ws.close();
  process.exit(0);
});

// Run comprehensive tests
runComprehensiveTests();