# Deployment Instructions

## Overview
This guide provides step-by-step instructions for deploying the AI proxy server and migrating from Gemini to free/open alternatives.

## Prerequisites

### System Requirements
- Node.js 18+ installed
- npm or yarn package manager
- Git for version control
- Text editor (VS Code recommended)
- Terminal/Command Prompt access

### Accounts Required
- OpenRouter account (free tier available)
- OR DeepSeek account (free tier available)
- OR Groq account (free tier available)
- OR Ollama for local hosting (completely free)

## Phase 1: Immediate Migration (External APIs)

### Step 1: Backup Current System
```bash
# Navigate to your project directory
cd "C:\Users\MattewAninga\myprojects\quote 2 - Copy"

# Create backup directory
mkdir backup
mkdir backup\$(Get-Date -Format "yyyy-MM-dd")

# Backup current files
copy src\App.jsx backup\$(Get-Date -Format "yyyy-MM-dd")\App.jsx.backup
copy package.json backup\$(Get-Date -Format "yyyy-MM-dd")\package.json.backup
copy .env backup\$(Get-Date -Format "yyyy-MM-dd")\.env.backup 2>$null
```

### Step 2: Set Up AI Proxy Server
```bash
# Create server directory
mkdir server
cd server

# Copy server files from CLAUDE_PACKAGE
copy ..\CLAUDE_PACKAGE\server\* .

# Install dependencies
npm install
```

### Step 3: Configure Environment Variables
```bash
# Create environment file
copy ..\CLAUDE_PACKAGE\env.example .env

# Edit the .env file with your preferred editor
notepad .env
```

**Configure for OpenRouter (Recommended):**
```bash
# .env file contents
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=deepseek/deepseek-chat
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

**Configure for DeepSeek:**
```bash
# .env file contents
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

**Configure for Groq:**
```bash
# .env file contents
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama3-8b-8192

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

### Step 4: Test the Proxy Server
```bash
# Start the server
npm start

# In another terminal, test the API
curl -X POST http://localhost:3001/api/ai/generate ^
  -H "Content-Type: application/json" ^
  -d "{\"message\": \"Hello, test message\", \"history\": []}"
```

**Expected Response:**
```json
{
  "success": true,
  "response": "Hello! How can I help you today?",
  "actions": [],
  "provider": "openrouter"
}
```

### Step 5: Update Client Code
```bash
# Navigate back to project root
cd ..

# Apply the client migration patch
git apply CLAUDE_PACKAGE\patches\client-migration.patch
```

**Manual Update (if patch fails):**
1. Open `src/App.jsx`
2. Find line 4118: `const apiKey = "AIzaSyDSTOJuXixi0GrOyP0TPmasf7l2ku6I26c";`
3. Replace the entire `handleSendMessage` function (lines 4120-4256) with:

```javascript
const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    
    setIsAiLoading(true);
    const userMessage = userInput.trim();
    setUserInput('');
    
    // Add user message to chat history
    const newHistory = [...chatHistory, { role: 'user', parts: [{ text: userMessage }] }];
    setChatHistory(newHistory);
    
    try {
        // Build context data
        const inventoryContext = inventory.map(item => 
            `${item.name} (SKU: ${item.id}) - ${formatCurrency(getItemPrice(item))} (Stock: ${item.stock})`
        ).join('\n');
        
        const customerContext = customers.map(customer => 
            `${customer.name} (${customer.email || 'No email'}) - ${customer.company || 'No company'}`
        ).join('\n');
        
        const quoteContext = quoteItems.map(item => 
            `${item.name} x${item.quantity} - ${formatCurrency(getItemPrice(item))} each`
        ).join('\n');
        
        // Call the AI proxy server
        const response = await fetch('http://localhost:3001/api/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                context: {
                    inventory: inventoryContext,
                    customers: customerContext,
                    quote: quoteContext
                },
                history: newHistory
            })
        });
        
        if (!response.ok) {
            throw new Error(`AI service error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'AI service failed');
        }
        
        // Process actions from the response
        const { actions, response: modelResponseText } = data;
        
        // Execute actions
        actions.forEach(action => {
            switch (action.type) {
                case 'ADD_TO_QUOTE':
                    const itemToAdd = inventory.find(i => i.id === action.sku);
                    if (itemToAdd) {
                        handleConfirmAddItem(itemToAdd, action.quantity);
                    }
                    break;
                    
                case 'REMOVE_FROM_QUOTE':
                    const itemToRemove = quoteItems.find(i => i.id === action.sku);
                    if (itemToRemove) {
                        handleRequestRemoveItem(itemToRemove);
                    }
                    break;
                    
                case 'REDUCE_QUOTE_QUANTITY':
                    const itemToUpdate = quoteItems.find(i => i.id === action.sku);
                    if (itemToUpdate) {
                        const newQty = itemToUpdate.quantity - action.quantity;
                        if (newQty > 0) {
                            setQuoteItems(currentItems => 
                                currentItems.map(i => i.id === action.sku ? { ...i, quantity: newQty } : i)
                            );
                        } else {
                            handleRequestRemoveItem(itemToUpdate);
                        }
                    }
                    break;
                    
                case 'SUGGEST_PRODUCTS':
                    const recommendations = generateProductRecommendations(action.context, quoteItems);
                    if (recommendations.length > 0) {
                        const recommendationText = `\n\nRECOMMENDED PRODUCTS:\n${recommendations.map(item => 
                            `• ${item.name} - ${formatCurrency(getItemPrice(item))} (Stock: ${item.stock})`
                        ).join('\n')}`;
                        modelResponseText += recommendationText;
                    }
                    break;
            }
        });
        
        const normalized = normalizeAssistantText(modelResponseText.trim());
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: normalized }] }]);
        
    } catch (error) {
        console.error('AI Error:', error);
        setChatHistory(prev => [...prev, { 
            role: 'model', 
            parts: [{ text: 'Sorry, I encountered an error. Please try again.' }] 
        }]);
    } finally {
        setIsAiLoading(false);
    }
};
```

### Step 6: Test the Complete System
```bash
# Start the proxy server (in one terminal)
cd server
npm start

# Start the client application (in another terminal)
cd ..
npm run dev
```

**Test Steps:**
1. Open browser to `http://localhost:5173`
2. Navigate to the Quote AI Assistant
3. Send a test message: "I need a printer for my office"
4. Verify the response and any actions executed
5. Check browser console for errors
6. Verify proxy server logs

## Phase 2: Local Hosting (Ollama)

### Step 1: Install Ollama
```bash
# Download from https://ollama.ai
# Or using package manager
winget install Ollama.Ollama

# Start Ollama service
ollama serve
```

### Step 2: Download Recommended Model
```bash
# Download Llama 3.1 8B (recommended)
ollama pull llama3.1:8b

# Test the model
ollama run llama3.1:8b "Hello, how are you?"
```

### Step 3: Configure for Local Hosting
```bash
# Update server .env file
cd server
notepad .env
```

**Update .env for Ollama:**
```bash
# .env file contents
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

### Step 4: Test Local Hosting
```bash
# Restart the proxy server
npm start

# Test with curl
curl -X POST http://localhost:3001/api/ai/generate ^
  -H "Content-Type: application/json" ^
  -d "{\"message\": \"Hello, test message\", \"history\": []}"
```

## Phase 3: Production Deployment

### Step 1: Production Environment Setup
```bash
# Update .env for production
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_production_api_key
OPENROUTER_MODEL=deepseek/deepseek-chat

# Production Configuration
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://your-domain.com

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Step 2: Process Management
```bash
# Install PM2 for process management
npm install -g pm2

# Create PM2 ecosystem file
notepad ecosystem.config.js
```

**ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'ai-proxy',
    script: 'ai-proxy.js',
    cwd: './server',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### Step 3: Start Production Server
```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

### Step 4: Nginx Configuration (Optional)
```bash
# Install Nginx
# Create configuration file
notepad /etc/nginx/sites-available/ai-proxy
```

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location /api/ai/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Monitoring & Maintenance

### Step 1: Health Monitoring
```bash
# Create health check script
notepad health_check.bat
```

**health_check.bat:**
```batch
@echo off
echo Checking AI Proxy Health...

curl -s http://localhost:3001/api/ai/health > nul
if %errorlevel% equ 0 (
    echo AI Proxy: OK
) else (
    echo AI Proxy: FAILED
    echo Restarting service...
    pm2 restart ai-proxy
)

echo Health check completed.
```

### Step 2: Log Monitoring
```bash
# View PM2 logs
pm2 logs ai-proxy

# View server logs
tail -f server/logs/combined.log
```

### Step 3: Performance Monitoring
```bash
# Monitor PM2 processes
pm2 monit

# Check system resources
htop
```

## Rollback Procedures

### Emergency Rollback
```bash
# Stop the proxy server
pm2 stop ai-proxy

# Restore backup files
copy backup\$(Get-Date -Format "yyyy-MM-dd")\App.jsx.backup src\App.jsx

# Restart the client
npm run dev
```

### Gradual Rollback
```bash
# Switch back to Gemini temporarily
# Update .env file
AI_PROVIDER=gemini
GEMINI_API_KEY=your_backup_gemini_key

# Restart services
pm2 restart ai-proxy
```

## Troubleshooting

### Common Issues

#### 1. CORS Errors
```bash
# Check CORS configuration in .env
CORS_ORIGIN=http://localhost:5173

# Verify the client is running on the correct port
```

#### 2. API Key Issues
```bash
# Verify API key is set correctly
echo $OPENROUTER_API_KEY

# Test API key manually
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models
```

#### 3. Port Conflicts
```bash
# Check if port 3001 is in use
netstat -an | findstr :3001

# Change port in .env if needed
PORT=3002
```

#### 4. Model Not Found
```bash
# For Ollama, check available models
ollama list

# Download the model if missing
ollama pull llama3.1:8b
```

### Debug Commands
```bash
# Check proxy server status
curl http://localhost:3001/api/ai/health

# Check available providers
curl http://localhost:3001/api/ai/providers

# Test with sample data
curl -X POST http://localhost:3001/api/ai/generate ^
  -H "Content-Type: application/json" ^
  -d @CLAUDE_PACKAGE\samples\test-request.json
```

## Success Validation

### Checklist
- [ ] Proxy server starts without errors
- [ ] API health check returns OK
- [ ] Client connects to proxy successfully
- [ ] AI responses are generated correctly
- [ ] Action parsing works as expected
- [ ] No CORS errors in browser console
- [ ] Response times are acceptable (< 5 seconds)
- [ ] Error handling works properly
- [ ] Rate limiting is functional
- [ ] Security measures are in place

### Performance Benchmarks
- Response time: < 5 seconds
- Uptime: > 99%
- Error rate: < 1%
- Memory usage: < 512MB
- CPU usage: < 50%

## Post-Deployment Tasks

### 1. Documentation
- [ ] Update user documentation
- [ ] Create troubleshooting guide
- [ ] Document configuration changes
- [ ] Update API documentation

### 2. Training
- [ ] Train support team
- [ ] Create user training materials
- [ ] Document common issues
- [ ] Setup monitoring alerts

### 3. Monitoring
- [ ] Setup log aggregation
- [ ] Configure alerting
- [ ] Monitor performance metrics
- [ ] Track usage patterns

This comprehensive deployment guide ensures successful migration with minimal downtime and maximum reliability.
