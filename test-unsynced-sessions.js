const WebSocket = require('ws');

class UnsyncedSessionsTester {
    constructor() {
        this.ws = null;
        // Use localhost for development testing
        this.serverUrl = 'ws://localhost:3000';
        this.httpUrl = 'http://localhost:3002';
    }

    async connect() {
        console.log('🔗 Connecting to simulator...');
        this.ws = new WebSocket(this.serverUrl);
        
        return new Promise((resolve, reject) => {
            this.ws.on('open', () => {
                console.log('✅ Connected to simulator');
                resolve();
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ Connection error:', error);
                reject(error);
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('📥 Received:', JSON.stringify(message, null, 2));
                } catch (error) {
                    console.log('📥 Received (raw):', data.toString());
                }
            });
        });
    }

    async createTestSessions() {
        console.log('\n🧪 Creating test sessions...');
        try {
            const response = await fetch(`${this.httpUrl}/test/create-sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            console.log('✅ Test sessions created:', result);
            return result;
        } catch (error) {
            console.error('❌ Failed to create test sessions:', error);
        }
    }

    async getSessionsStatus() {
        console.log('\n📊 Getting sessions status...');
        try {
            const response = await fetch(`${this.httpUrl}/test/sessions-status`);
            const result = await response.json();
            console.log('📈 Sessions Status:');
            console.log(`   Total: ${result.totalSessions}`);
            console.log(`   Unsynced: ${result.unsyncedSessions}`);
            console.log(`   Synced: ${result.syncedSessions}`);
            return result;
        } catch (error) {
            console.error('❌ Failed to get sessions status:', error);
        }
    }

    async testGetUnsyncedSessions() {
        console.log('\n🔄 Testing get_unsynced_sessions command...');
        
        const command = {
            type: "action",
            command: "get_unsynced_sessions",
            session: "session_000000023",
            userId: "oky4MSvzXdg4bgOJWpV3nLlLct32"
        };

        console.log('📤 Sending command:', JSON.stringify(command, null, 2));
        this.ws.send(JSON.stringify(command));
        
        // Wait a bit for response
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    async resetUnsynced() {
        console.log('\n🔄 Resetting all sessions to unsynced...');
        try {
            const response = await fetch(`${this.httpUrl}/test/reset-unsynced`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            console.log('✅ Sessions reset to unsynced:', result);
            return result;
        } catch (error) {
            console.error('❌ Failed to reset sessions:', error);
        }
    }

    async runTest() {
        try {
            await this.connect();
            
            // Create test sessions
            await this.createTestSessions();
            
            // Check initial status
            await this.getSessionsStatus();
            
            // Test getting unsynced sessions (first batch of 5)
            await this.testGetUnsyncedSessions();
            
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check status after first sync
            await this.getSessionsStatus();
            
            // Test getting remaining unsynced sessions
            await this.testGetUnsyncedSessions();
            
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Final status check
            await this.getSessionsStatus();
            
            // Reset all to unsynced for next test
            await this.resetUnsynced();
            
            console.log('\n✅ Test completed successfully!');
            
        } catch (error) {
            console.error('❌ Test failed:', error);
        } finally {
            if (this.ws) {
                this.ws.close();
            }
        }
    }
}

// Run the test
const tester = new UnsyncedSessionsTester();
tester.runTest().catch(console.error);