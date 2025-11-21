// Backup the current state and create a clean command handler
// This will replace the broken command handling section

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
      case 'start':
        if (!deviceState.isCharging) {
          const session = startChargingSession('manual');
          response = { 
            ack: true, 
            msg: 'Charging started',
            session: session
          };
          console.log('📱 Legacy Command: Start charging');
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
          console.log('📱 Legacy Command: Stop charging');
        } else {
          response = { ack: false, msg: 'Not charging' };
        }
        break;
        
      case 'get_status':
        response = {
          ack: true,
          msg: 'Device status',
          status: {
            deviceId: deviceInfo.deviceId,
            charging: deviceState.isCharging,
            energy: deviceState.energyKWh,
            currentRFID: deviceState.currentRFID,
            rfids: rfids.length
          }
        };
        break;
        
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
  
  // Config commands
  if (command.type === 'config') {
    switch (command.command) {
      case 'network':
        if (command.data && typeof command.data.ssid === 'string' && typeof command.data.password === 'string') {
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
  
  ws.send(JSON.stringify(response));
}