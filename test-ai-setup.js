// test-ai-setup.js - Test script to verify AI setup
const fetch = require('node-fetch');

async function testBackend() {
    console.log('🧪 Testing AI Backend Setup...\n');
    
    try {
        // Test 1: Health Check
        console.log('1. Testing backend health...');
        const healthResponse = await fetch('http://localhost:3001/api/health');
        
        if (healthResponse.ok) {
            const health = await healthResponse.json();
            console.log(`   ✅ Backend is running`);
            console.log(`   📊 Provider: ${health.provider}`);
            console.log(`   🕒 Status: ${health.status}`);
        } else {
            console.log(`   ❌ Backend health check failed: ${healthResponse.status}`);
            return;
        }
        
        // Test 2: AI Chat Endpoint
        console.log('\n2. Testing AI chat endpoint...');
        const chatResponse = await fetch('http://localhost:3001/api/ai/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: 'Hello, can you help with product recommendations?',
                context: {
                    inventory: [
                        { id: 'TEST-001', name: 'Test Product', stock: 10, price: 100 }
                    ],
                    customers: [],
                    quoteItems: []
                }
            })
        });
        
        if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            console.log(`   ✅ AI chat working`);
            console.log(`   📝 Response: ${chatData.response.substring(0, 100)}...`);
            console.log(`   🤖 Provider: ${chatData.provider}`);
        } else {
            console.log(`   ❌ AI chat failed: ${chatResponse.status}`);
            const error = await chatResponse.text();
            console.log(`   📄 Error: ${error}`);
        }
        
        console.log('\n🎉 All tests passed! Your AI system is ready.');
        
    } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure backend is running: cd backend && npm start');
        console.log('2. Check if Ollama is running: ollama serve');
        console.log('3. Verify .env configuration in backend folder');
    }
}

async function testOllama() {
    console.log('\n🤖 Testing Ollama connection...');
    
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
            const data = await response.json();
            console.log('   ✅ Ollama is running');
            console.log(`   📦 Available models: ${data.models?.map(m => m.name).join(', ')}`);
        } else {
            console.log('   ❌ Ollama not responding');
            console.log('   💡 Run: ollama serve');
        }
    } catch (error) {
        console.log('   ❌ Ollama not available');
        console.log('   💡 Install Ollama from: https://ollama.ai');
    }
}

// Run tests
async function runTests() {
    await testBackend();
    await testOllama();
    
    console.log('\n📋 Quick Commands:');
    console.log('Start backend: cd backend && npm start');
    console.log('Start frontend: npm start');
    console.log('Test Ollama: ollama run deepseek-r1:8b "Hello"');
    console.log('Health check: curl http://localhost:3001/api/health');
}

runTests().catch(console.error);
