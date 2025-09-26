# 📱 WiseCar Flutter Integration Guide

## 🎯 Overview

This guide shows you how to integrate your Flutter app with the WiseCar EV charger simulator. The simulator acts as a real EV charger device, allowing you to develop and test your app without physical hardware.

## 🏗️ Architecture

```
Flutter App  ←→  WebSocket  ←→  WiseCar Simulator  ←→  Firestore
     ↓                              ↓                    ↓
- Device Discovery            - Live Telemetry        - Device Info
- Real-time Control          - Command Processing     - User Settings  
- UI Updates                 - Status Updates        - Session Data
```

## 📋 Data Flow

### **1. Device Discovery & Registration**
```
App → mDNS Scan → Find Device → WebSocket Connect → Get Device Info → Store in Firestore
```

### **2. Real-time Operation** 
```
Simulator → Telemetry (every 5s) → App → UI Update
App → Commands → Simulator → Response → App → UI Update
```

### **3. Data Storage Strategy**
- **Static Data (Admin enters once)**: `displayName`, `ownerUid`, `costPerKWh`, `warranty`
- **Device Data (from simulator)**: `deviceId`, `info.*`, `network.*`, `settings.*`
- **Live Data (real-time)**: `telemetry.*` (updated every 5 seconds)

---

## 🔍 Step 1: Device Discovery

### **A. Add Dependencies**
```yaml
# pubspec.yaml
dependencies:
  multicast_dns: ^0.3.2+3
  web_socket_channel: ^2.4.0
  json_annotation: ^4.8.1
  
dev_dependencies:
  json_serializable: ^6.7.1
  build_runner: ^2.4.7
```

### **B. mDNS Device Discovery**
```dart
import 'package:multicast_dns/multicast_dns.dart';

class DeviceDiscoveryService {
  static const String SERVICE_TYPE = '_wisecar._tcp.local';
  
  Future<List<DiscoveredDevice>> scanForDevices() async {
    final MDnsClient client = MDnsClient();
    final List<DiscoveredDevice> devices = [];
    
    try {
      // Start mDNS lookup
      await client.startLookup(
        ResourceRecordQuery.serverPointer(SERVICE_TYPE)
      );
      
      // Listen for discovered services
      await for (PtrResourceRecord ptr in client.lookup(
        ResourceRecordQuery.serverPointer(SERVICE_TYPE)
      ).take(10)) {
        
        // Get service details
        await for (SrvResourceRecord srv in client.lookup(
          ResourceRecordQuery.service(ptr.domainName)
        ).take(1)) {
          
          // Get IP address
          await for (IPAddressResourceRecord ip in client.lookup(
            ResourceRecordQuery.addressIPv4(srv.target)
          ).take(1)) {
            
            devices.add(DiscoveredDevice(
              name: ptr.domainName,
              host: ip.address.address,
              port: srv.port,
              target: srv.target,
            ));
          }
        }
      }
    } finally {
      client.stop();
    }
    
    return devices;
  }
}

class DiscoveredDevice {
  final String name;
  final String host;
  final int port;
  final String target;
  
  DiscoveredDevice({
    required this.name,
    required this.host, 
    required this.port,
    required this.target,
  });
  
  String get websocketUrl => 'ws://$host:$port';
}
```

### **C. Device Discovery UI**
```dart
class DeviceDiscoveryScreen extends StatefulWidget {
  @override
  _DeviceDiscoveryScreenState createState() => _DeviceDiscoveryScreenState();
}

class _DeviceDiscoveryScreenState extends State<DeviceDiscoveryScreen> {
  List<DiscoveredDevice> _devices = [];
  bool _isScanning = false;
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Discover EV Chargers'),
        actions: [
          IconButton(
            icon: Icon(_isScanning ? Icons.stop : Icons.search),
            onPressed: _isScanning ? _stopScan : _startScan,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_isScanning)
            LinearProgressIndicator(),
          
          Expanded(
            child: _devices.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.ev_station, size: 64, color: Colors.grey),
                        SizedBox(height: 16),
                        Text('No EV chargers found'),
                        SizedBox(height: 8),
                        Text('Make sure the device is on the same network'),
                        SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _startScan,
                          child: Text('Scan for Devices'),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    itemCount: _devices.length,
                    itemBuilder: (context, index) {
                      final device = _devices[index];
                      return DeviceDiscoveryTile(
                        device: device,
                        onTap: () => _connectToDevice(device),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
  
  Future<void> _startScan() async {
    setState(() {
      _isScanning = true;
      _devices.clear();
    });
    
    try {
      final devices = await DeviceDiscoveryService().scanForDevices();
      setState(() {
        _devices = devices;
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Scan failed: $e')),
      );
    } finally {
      setState(() {
        _isScanning = false;
      });
    }
  }
  
  void _stopScan() {
    setState(() {
      _isScanning = false;
    });
  }
  
  void _connectToDevice(DiscoveredDevice device) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => DeviceSetupScreen(device: device),
      ),
    );
  }
}

class DeviceDiscoveryTile extends StatelessWidget {
  final DiscoveredDevice device;
  final VoidCallback onTap;
  
  const DeviceDiscoveryTile({
    required this.device,
    required this.onTap,
  });
  
  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(Icons.ev_station, color: Colors.green),
        title: Text(device.name.replaceAll('.local', '')),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('IP: ${device.host}:${device.port}'),
            Text('Status: Available'),
          ],
        ),
        trailing: Icon(Icons.arrow_forward_ios),
        onTap: onTap,
      ),
    );
  }
}
```

---

## 🔗 Step 2: WebSocket Connection

### **A. Device Data Models**
```dart
import 'package:json_annotation/json_annotation.dart';

part 'device_models.g.dart';

@JsonSerializable()
class DeviceHandshake {
  final String event;
  final String deviceId;
  final String displayName;
  final DeviceInfo info;
  final WarrantyInfo warranty;
  final NetworkInfo network;
  final DeviceSettings settings;
  
  DeviceHandshake({
    required this.event,
    required this.deviceId,
    required this.displayName,
    required this.info,
    required this.warranty,
    required this.network,
    required this.settings,
  });
  
  factory DeviceHandshake.fromJson(Map<String, dynamic> json) =>
      _$DeviceHandshakeFromJson(json);
  Map<String, dynamic> toJson() => _$DeviceHandshakeToJson(this);
}

@JsonSerializable()
class DeviceInfo {
  final String firmware;
  final String model;
  final int phases;
  final bool rfidSupported;
  final String serial;
  
  DeviceInfo({
    required this.firmware,
    required this.model,
    required this.phases,
    required this.rfidSupported,
    required this.serial,
  });
  
  factory DeviceInfo.fromJson(Map<String, dynamic> json) =>
      _$DeviceInfoFromJson(json);
  Map<String, dynamic> toJson() => _$DeviceInfoToJson(this);
}

@JsonSerializable()
class WarrantyInfo {
  final int start;
  final int end;
  
  WarrantyInfo({required this.start, required this.end});
  
  factory WarrantyInfo.fromJson(Map<String, dynamic> json) =>
      _$WarrantyInfoFromJson(json);
  Map<String, dynamic> toJson() => _$WarrantyInfoToJson(this);
  
  DateTime get startDate => DateTime.fromMillisecondsSinceEpoch(start * 1000);
  DateTime get endDate => DateTime.fromMillisecondsSinceEpoch(end * 1000);
}

@JsonSerializable()
class NetworkInfo {
  final String lastIp;
  final String mode;
  
  NetworkInfo({required this.lastIp, required this.mode});
  
  factory NetworkInfo.fromJson(Map<String, dynamic> json) =>
      _$NetworkInfoFromJson(json);
  Map<String, dynamic> toJson() => _$NetworkInfoToJson(this);
}

@JsonSerializable()
class DeviceSettings {
  final bool appNotifications;
  final bool autoPlug;
  final double costPerKWh;
  final bool deviceNotifications;
  final bool fastCharging;
  final String language;
  final int limitA;
  
  DeviceSettings({
    required this.appNotifications,
    required this.autoPlug,
    required this.costPerKWh,
    required this.deviceNotifications,
    required this.fastCharging,
    required this.language,
    required this.limitA,
  });
  
  factory DeviceSettings.fromJson(Map<String, dynamic> json) =>
      _$DeviceSettingsFromJson(json);
  Map<String, dynamic> toJson() => _$DeviceSettingsToJson(this);
}

@JsonSerializable()
class TelemetryData {
  final String event;
  final String deviceId;
  final Telemetry telemetry;
  
  TelemetryData({
    required this.event,
    required this.deviceId,
    required this.telemetry,
  });
  
  factory TelemetryData.fromJson(Map<String, dynamic> json) =>
      _$TelemetryDataFromJson(json);
  Map<String, dynamic> toJson() => _$TelemetryDataToJson(this);
}

@JsonSerializable()
class Telemetry {
  final String status;
  final double voltage;
  final double currentA;
  final double energyKWh;
  final double temperatureC;
  final int phases;
  final int updatedAt;
  
  Telemetry({
    required this.status,
    required this.voltage,
    required this.currentA,
    required this.energyKWh,
    required this.temperatureC,
    required this.phases,
    required this.updatedAt,
  });
  
  factory Telemetry.fromJson(Map<String, dynamic> json) =>
      _$TelemetryFromJson(json);
  Map<String, dynamic> toJson() => _$TelemetryToJson(this);
  
  DateTime get updatedAtDate => 
      DateTime.fromMillisecondsSinceEpoch(updatedAt * 1000);
  
  bool get isCharging => status == 'charging';
}

@JsonSerializable()
class CommandResponse {
  final bool ack;
  final String msg;
  
  CommandResponse({required this.ack, required this.msg});
  
  factory CommandResponse.fromJson(Map<String, dynamic> json) =>
      _$CommandResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CommandResponseToJson(this);
}
```

### **B. WebSocket Service**
```dart
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:convert';
import 'dart:async';

class ChargerWebSocketService {
  WebSocketChannel? _channel;
  StreamController<DeviceHandshake>? _handshakeController;
  StreamController<TelemetryData>? _telemetryController;
  StreamController<CommandResponse>? _commandController;
  StreamController<bool>? _connectionController;
  
  // Public streams
  Stream<DeviceHandshake> get handshakeStream => 
      _handshakeController?.stream ?? Stream.empty();
  Stream<TelemetryData> get telemetryStream => 
      _telemetryController?.stream ?? Stream.empty();
  Stream<CommandResponse> get commandResponseStream => 
      _commandController?.stream ?? Stream.empty();
  Stream<bool> get connectionStream => 
      _connectionController?.stream ?? Stream.empty();
  
  bool get isConnected => _channel != null;
  
  Future<bool> connect(String url) async {
    try {
      // Initialize controllers
      _handshakeController = StreamController<DeviceHandshake>.broadcast();
      _telemetryController = StreamController<TelemetryData>.broadcast();
      _commandController = StreamController<CommandResponse>.broadcast();
      _connectionController = StreamController<bool>.broadcast();
      
      // Connect to WebSocket
      _channel = WebSocketChannel.connect(Uri.parse(url));
      
      // Listen to messages
      _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDisconnection,
      );
      
      _connectionController!.add(true);
      return true;
      
    } catch (e) {
      print('Connection failed: $e');
      _connectionController?.add(false);
      return false;
    }
  }
  
  void _handleMessage(dynamic message) {
    try {
      final data = json.decode(message);
      
      switch (data['event']) {
        case 'hello':
          final handshake = DeviceHandshake.fromJson(data);
          _handshakeController?.add(handshake);
          break;
          
        case 'telemetry':
          final telemetry = TelemetryData.fromJson(data);
          _telemetryController?.add(telemetry);
          break;
      }
      
      // Handle command responses
      if (data.containsKey('ack')) {
        final response = CommandResponse.fromJson(data);
        _commandController?.add(response);
      }
      
    } catch (e) {
      print('Failed to parse message: $e');
    }
  }
  
  void _handleError(dynamic error) {
    print('WebSocket error: $error');
    _connectionController?.add(false);
  }
  
  void _handleDisconnection() {
    print('WebSocket disconnected');
    _connectionController?.add(false);
    _cleanup();
  }
  
  // Command methods
  Future<void> startCharging() async {
    _sendCommand({'action': 'start'});
  }
  
  Future<void> stopCharging() async {
    _sendCommand({'action': 'stop'});
  }
  
  Future<void> setCurrentLimit(int amperes) async {
    _sendCommand({'action': 'set_limitA', 'value': amperes});
  }
  
  Future<void> resetEnergy() async {
    _sendCommand({'action': 'reset_energy'});
  }
  
  void _sendCommand(Map<String, dynamic> command) {
    if (_channel != null) {
      _channel!.sink.add(json.encode(command));
    }
  }
  
  void disconnect() {
    _channel?.sink.close();
    _cleanup();
  }
  
  void _cleanup() {
    _channel = null;
    _handshakeController?.close();
    _telemetryController?.close();
    _commandController?.close();
    _connectionController?.close();
  }
}
```

---

## 💾 Step 3: Firestore Integration

### **A. Device Document Structure**
```dart
// Firestore Document Structure
class FirestoreDevice {
  // Admin-entered fields (set once)
  final String? ownerUid;           // Set when user adds device
  final String? displayName;       // User-customizable name
  final int? createdAt;            // When added to Firestore
  final double? costPerKWh;        // Local electricity cost
  
  // Device fields (from WebSocket handshake)
  final String deviceId;
  final DeviceInfo info;
  final WarrantyInfo warranty;
  final NetworkInfo network;
  final DeviceSettings settings;
  
  // Live telemetry (updated every 5 seconds)
  final Telemetry? telemetry;
  
  FirestoreDevice({
    this.ownerUid,
    this.displayName,
    this.createdAt,
    this.costPerKWh,
    required this.deviceId,
    required this.info,
    required this.warranty,
    required this.network,
    required this.settings,
    this.telemetry,
  });
  
  Map<String, dynamic> toFirestore() {
    return {
      'ownerUid': ownerUid,
      'displayName': displayName,
      'createdAt': createdAt,
      'deviceId': deviceId,
      'info': info.toJson(),
      'warranty': warranty.toJson(),
      'network': network.toJson(),
      'settings': settings.toJson(),
      'telemetry': telemetry?.toJson(),
      if (costPerKWh != null) 'costPerKWh': costPerKWh,
    };
  }
  
  factory FirestoreDevice.fromFirestore(Map<String, dynamic> data) {
    return FirestoreDevice(
      ownerUid: data['ownerUid'],
      displayName: data['displayName'],
      createdAt: data['createdAt'],
      costPerKWh: data['costPerKWh']?.toDouble(),
      deviceId: data['deviceId'],
      info: DeviceInfo.fromJson(data['info']),
      warranty: WarrantyInfo.fromJson(data['warranty']),
      network: NetworkInfo.fromJson(data['network']),
      settings: DeviceSettings.fromJson(data['settings']),
      telemetry: data['telemetry'] != null 
          ? Telemetry.fromJson(data['telemetry']) 
          : null,
    );
  }
}
```

### **B. Firestore Service**
```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class DeviceFirestoreService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;
  
  // Add device to Firestore (after WebSocket handshake)
  Future<String> addDevice(DeviceHandshake handshake, {
    String? customName,
    double? costPerKWh,
  }) async {
    final user = _auth.currentUser;
    if (user == null) throw Exception('User not authenticated');
    
    final device = FirestoreDevice(
      ownerUid: user.uid,
      displayName: customName ?? handshake.displayName,
      createdAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      costPerKWh: costPerKWh ?? 0.0,
      deviceId: handshake.deviceId,
      info: handshake.info,
      warranty: handshake.warranty,
      network: handshake.network,
      settings: handshake.settings,
    );
    
    final docRef = await _firestore
        .collection('devices')
        .add(device.toFirestore());
    
    return docRef.id;
  }
  
  // Update telemetry data (called every 5 seconds)
  Future<void> updateTelemetry(String docId, Telemetry telemetry) async {
    await _firestore
        .collection('devices')
        .doc(docId)
        .update({'telemetry': telemetry.toJson()});
  }
  
  // Get user's devices
  Stream<List<FirestoreDevice>> getUserDevices() {
    final user = _auth.currentUser;
    if (user == null) return Stream.empty();
    
    return _firestore
        .collection('devices')
        .where('ownerUid', isEqualTo: user.uid)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => FirestoreDevice.fromFirestore(doc.data()))
            .toList());
  }
  
  // Update device settings
  Future<void> updateDeviceSettings(String docId, DeviceSettings settings) async {
    await _firestore
        .collection('devices')
        .doc(docId)
        .update({'settings': settings.toJson()});
  }
  
  // Update custom display name
  Future<void> updateDisplayName(String docId, String name) async {
    await _firestore
        .collection('devices')
        .doc(docId)
        .update({'displayName': name});
  }
  
  // Update cost per kWh
  Future<void> updateCostPerKWh(String docId, double cost) async {
    await _firestore
        .collection('devices')
        .doc(docId)
        .update({'costPerKWh': cost});
  }
}
```

---

## 🎮 Step 4: Device Control Screen

### **A. Main Control Screen**
```dart
class ChargerControlScreen extends StatefulWidget {
  final DiscoveredDevice discoveredDevice;
  final String? firestoreDocId;
  
  const ChargerControlScreen({
    required this.discoveredDevice,
    this.firestoreDocId,
  });
  
  @override
  _ChargerControlScreenState createState() => _ChargerControlScreenState();
}

class _ChargerControlScreenState extends State<ChargerControlScreen> {
  final ChargerWebSocketService _wsService = ChargerWebSocketService();
  final DeviceFirestoreService _firestoreService = DeviceFirestoreService();
  
  DeviceHandshake? _deviceInfo;
  Telemetry? _currentTelemetry;
  bool _isConnected = false;
  String? _statusMessage;
  
  @override
  void initState() {
    super.initState();
    _initializeConnection();
  }
  
  void _initializeConnection() {
    // Listen to connection status
    _wsService.connectionStream.listen((connected) {
      setState(() {
        _isConnected = connected;
        if (!connected) {
          _statusMessage = 'Disconnected';
        }
      });
    });
    
    // Listen to handshake
    _wsService.handshakeStream.listen((handshake) {
      setState(() {
        _deviceInfo = handshake;
        _statusMessage = 'Connected';
      });
      
      // Save to Firestore if new device
      if (widget.firestoreDocId == null) {
        _saveDeviceToFirestore(handshake);
      }
    });
    
    // Listen to telemetry
    _wsService.telemetryStream.listen((telemetryData) {
      setState(() {
        _currentTelemetry = telemetryData.telemetry;
      });
      
      // Update Firestore telemetry
      if (widget.firestoreDocId != null) {
        _firestoreService.updateTelemetry(
          widget.firestoreDocId!, 
          telemetryData.telemetry
        );
      }
    });
    
    // Listen to command responses
    _wsService.commandResponseStream.listen((response) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(response.msg),
          backgroundColor: response.ack ? Colors.green : Colors.red,
        ),
      );
    });
    
    // Connect to device
    _connectToDevice();
  }
  
  Future<void> _connectToDevice() async {
    setState(() {
      _statusMessage = 'Connecting...';
    });
    
    final success = await _wsService.connect(widget.discoveredDevice.websocketUrl);
    if (!success) {
      setState(() {
        _statusMessage = 'Connection failed';
      });
    }
  }
  
  Future<void> _saveDeviceToFirestore(DeviceHandshake handshake) async {
    // Show dialog for custom name and settings
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => DeviceSetupDialog(handshake: handshake),
    );
    
    if (result != null) {
      try {
        await _firestoreService.addDevice(
          handshake,
          customName: result['name'],
          costPerKWh: result['costPerKWh'],
        );
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Device added successfully')),
        );
      } catch (e) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save device: $e')),
        );
      }
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_deviceInfo?.displayName ?? 'EV Charger'),
        actions: [
          IconButton(
            icon: Icon(_isConnected ? Icons.wifi : Icons.wifi_off),
            onPressed: _isConnected ? null : _connectToDevice,
          ),
        ],
      ),
      body: _isConnected && _deviceInfo != null
          ? _buildConnectedView()
          : _buildDisconnectedView(),
    );
  }
  
  Widget _buildConnectedView() {
    return SingleChildScrollView(
      padding: EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Device Info Card
          _buildDeviceInfoCard(),
          SizedBox(height: 16),
          
          // Live Telemetry Card
          _buildTelemetryCard(),
          SizedBox(height: 16),
          
          // Control Buttons
          _buildControlButtons(),
          SizedBox(height: 16),
          
          // Settings
          _buildSettingsCard(),
        ],
      ),
    );
  }
  
  Widget _buildDisconnectedView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_off, size: 64, color: Colors.grey),
          SizedBox(height: 16),
          Text(
            _statusMessage ?? 'Disconnected',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          SizedBox(height: 16),
          ElevatedButton(
            onPressed: _connectToDevice,
            child: Text('Reconnect'),
          ),
        ],
      ),
    );
  }
  
  Widget _buildDeviceInfoCard() {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Device Information', 
                style: Theme.of(context).textTheme.titleLarge),
            SizedBox(height: 12),
            _buildInfoRow('Model', _deviceInfo!.info.model),
            _buildInfoRow('Serial', _deviceInfo!.info.serial),
            _buildInfoRow('Firmware', _deviceInfo!.info.firmware),
            _buildInfoRow('IP Address', _deviceInfo!.network.lastIp),
            _buildInfoRow('Device ID', _deviceInfo!.deviceId),
          ],
        ),
      ),
    );
  }
  
  Widget _buildTelemetryCard() {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Live Telemetry', 
                    style: Theme.of(context).textTheme.titleLarge),
                Spacer(),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _currentTelemetry?.isCharging == true 
                        ? Colors.green : Colors.orange,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    _currentTelemetry?.status.toUpperCase() ?? 'UNKNOWN',
                    style: TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ],
            ),
            SizedBox(height: 16),
            
            if (_currentTelemetry != null) ...[
              Row(
                children: [
                  _buildTelemetryTile(
                    'Voltage', 
                    '${_currentTelemetry!.voltage.toStringAsFixed(1)}V',
                    Icons.flash_on,
                  ),
                  _buildTelemetryTile(
                    'Current', 
                    '${_currentTelemetry!.currentA.toStringAsFixed(1)}A',
                    Icons.electric_bolt,
                  ),
                ],
              ),
              SizedBox(height: 12),
              Row(
                children: [
                  _buildTelemetryTile(
                    'Energy', 
                    '${_currentTelemetry!.energyKWh.toStringAsFixed(2)} kWh',
                    Icons.battery_charging_full,
                  ),
                  _buildTelemetryTile(
                    'Temperature', 
                    '${_currentTelemetry!.temperatureC.toStringAsFixed(1)}°C',
                    Icons.thermostat,
                  ),
                ],
              ),
            ] else ...[
              Center(
                child: CircularProgressIndicator(),
              ),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildTelemetryTile(String label, String value, IconData icon) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.all(12),
        margin: EdgeInsets.symmetric(horizontal: 4),
        decoration: BoxDecoration(
          color: Colors.grey[100],
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          children: [
            Icon(icon, color: Colors.blue),
            SizedBox(height: 4),
            Text(value, style: TextStyle(
              fontSize: 18, fontWeight: FontWeight.bold)),
            Text(label, style: TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
  
  Widget _buildControlButtons() {
    final isCharging = _currentTelemetry?.isCharging == true;
    
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Controls', style: Theme.of(context).textTheme.titleLarge),
            SizedBox(height: 16),
            
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    icon: Icon(Icons.play_arrow),
                    label: Text('Start Charging'),
                    onPressed: isCharging ? null : () => _wsService.startCharging(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    icon: Icon(Icons.stop),
                    label: Text('Stop Charging'),
                    onPressed: !isCharging ? null : () => _wsService.stopCharging(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
            
            SizedBox(height: 12),
            
            Row(
              children: [
                Text('Current Limit: '),
                Expanded(
                  child: Slider(
                    value: _deviceInfo?.settings.limitA.toDouble() ?? 16.0,
                    min: 6.0,
                    max: 16.0,
                    divisions: 10,
                    label: '${_deviceInfo?.settings.limitA ?? 16}A',
                    onChanged: (value) {
                      _wsService.setCurrentLimit(value.round());
                    },
                  ),
                ),
              ],
            ),
            
            SizedBox(height: 8),
            
            ElevatedButton.icon(
              icon: Icon(Icons.refresh),
              label: Text('Reset Energy Counter'),
              onPressed: () => _wsService.resetEnergy(),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildSettingsCard() {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Settings', style: Theme.of(context).textTheme.titleLarge),
            SizedBox(height: 12),
            
            SwitchListTile(
              title: Text('Fast Charging'),
              subtitle: Text('Enable high-speed charging'),
              value: _deviceInfo?.settings.fastCharging ?? false,
              onChanged: null, // Read-only from device
            ),
            
            SwitchListTile(
              title: Text('Auto Plug'),
              subtitle: Text('Start charging automatically when plugged'),
              value: _deviceInfo?.settings.autoPlug ?? false,
              onChanged: null, // Read-only from device
            ),
            
            ListTile(
              title: Text('Language'),
              subtitle: Text(_deviceInfo?.settings.language ?? 'Unknown'),
              trailing: Icon(Icons.language),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text('$label: ', style: TextStyle(fontWeight: FontWeight.bold)),
          Text(value),
        ],
      ),
    );
  }
  
  @override
  void dispose() {
    _wsService.disconnect();
    super.dispose();
  }
}
```

---

## 🔄 Step 5: Complete Integration Workflow

### **A. App Startup Flow**
```dart
class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WiseCar EV Manager',
      home: AuthWrapper(),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return SplashScreen();
        }
        
        if (snapshot.hasData) {
          return MainScreen();
        } else {
          return LoginScreen();
        }
      },
    );
  }
}

class MainScreen extends StatefulWidget {
  @override
  _MainScreenState createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _currentIndex = 0;
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: [
          MyDevicesScreen(),        // Saved devices from Firestore
          DeviceDiscoveryScreen(),  // Discover new devices
          ProfileScreen(),          // User profile
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: [
          BottomNavigationBarItem(
            icon: Icon(Icons.ev_station),
            label: 'My Devices',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.search),
            label: 'Discover',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
```

### **B. My Devices Screen (Firestore Integration)**
```dart
class MyDevicesScreen extends StatelessWidget {
  final DeviceFirestoreService _firestoreService = DeviceFirestoreService();
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('My EV Chargers'),
        actions: [
          IconButton(
            icon: Icon(Icons.add),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => DeviceDiscoveryScreen()),
            ),
          ),
        ],
      ),
      body: StreamBuilder<List<FirestoreDevice>>(
        stream: _firestoreService.getUserDevices(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return Center(child: CircularProgressIndicator());
          }
          
          if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}'));
          }
          
          final devices = snapshot.data ?? [];
          
          if (devices.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.ev_station_outlined, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('No chargers added yet'),
                  SizedBox(height: 8),
                  Text('Discover and add your first EV charger'),
                  SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (context) => DeviceDiscoveryScreen()),
                    ),
                    child: Text('Add Charger'),
                  ),
                ],
              ),
            );
          }
          
          return ListView.builder(
            itemCount: devices.length,
            itemBuilder: (context, index) {
              final device = devices[index];
              return DeviceListTile(device: device);
            },
          );
        },
      ),
    );
  }
}

class DeviceListTile extends StatelessWidget {
  final FirestoreDevice device;
  
  const DeviceListTile({required this.device});
  
  @override
  Widget build(BuildContext context) {
    final isOnline = device.telemetry != null && 
        DateTime.now().difference(device.telemetry!.updatedAtDate).inMinutes < 2;
    final isCharging = device.telemetry?.isCharging ?? false;
    
    return Card(
      child: ListTile(
        leading: Icon(
          Icons.ev_station,
          color: isCharging ? Colors.green : (isOnline ? Colors.blue : Colors.grey),
        ),
        title: Text(device.displayName ?? device.info.model),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Serial: ${device.info.serial}'),
            Text('Status: ${isOnline ? (isCharging ? 'Charging' : 'Connected') : 'Offline'}'),
            if (device.telemetry != null && isCharging)
              Text('Power: ${device.telemetry!.currentA.toStringAsFixed(1)}A • ${device.telemetry!.energyKWh.toStringAsFixed(2)} kWh'),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (device.telemetry?.isCharging == true)
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: Colors.green,
                  shape: BoxShape.circle,
                ),
              ),
            SizedBox(width: 8),
            Icon(Icons.arrow_forward_ios),
          ],
        ),
        onTap: () {
          // Try to connect to device using stored network info
          final discoveredDevice = DiscoveredDevice(
            name: '${device.deviceId}.local',
            host: device.network.lastIp,
            port: 3000, // Default port
            target: '${device.deviceId}.local',
          );
          
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => ChargerControlScreen(
                discoveredDevice: discoveredDevice,
                firestoreDocId: device.deviceId, // Use device ID as Firestore doc ID
              ),
            ),
          );
        },
      ),
    );
  }
}
```

---

## 🚀 Step 6: Testing & Validation

### **A. Testing Checklist**
```dart
// Test Cases for Your Flutter App

void main() {
  group('WiseCar Integration Tests', () {
    
    testWidgets('Device Discovery', (tester) async {
      // Test mDNS discovery
      // Test device list display
      // Test connection to simulator
    });
    
    testWidgets('WebSocket Connection', (tester) async {
      // Test connection establishment
      // Test handshake reception
      // Test telemetry updates
      // Test command sending
      // Test reconnection after disconnect
    });
    
    testWidgets('Firestore Integration', (tester) async {
      // Test device saving
      // Test telemetry updates
      // Test offline data reading
    });
    
    testWidgets('UI Updates', (tester) async {
      // Test real-time telemetry display
      // Test charging status changes
      // Test control button states
    });
    
  });
}
```

### **B. Debugging Tips**
```dart
class DebugHelper {
  static void enableWebSocketLogging() {
    // Add to main() for debugging
    debugPrint('WebSocket debugging enabled');
  }
  
  static void logTelemetryData(TelemetryData data) {
    debugPrint('Telemetry: ${data.telemetry.status} | '
               '${data.telemetry.voltage}V | '
               '${data.telemetry.currentA}A | '
               '${data.telemetry.energyKWh}kWh');
  }
  
  static void logFirestoreOperations(String operation, String deviceId) {
    debugPrint('Firestore $operation for device: $deviceId');
  }
}
```

---

## 🎯 Summary

This integration guide provides:

1. **✅ Complete mDNS discovery implementation**
2. **✅ WebSocket connection with error handling** 
3. **✅ Real-time telemetry processing**
4. **✅ Command sending (start/stop/limits)**
5. **✅ Firestore integration for device storage**
6. **✅ Live UI updates every 5 seconds**
7. **✅ Proper data separation (admin vs device vs live data)**
8. **✅ Production-ready error handling**

Your Flutter app will now seamlessly connect to the WiseCar simulator and behave exactly as it would with real hardware! 🔌⚡

Generate the model files with: `flutter packages pub run build_runner build`