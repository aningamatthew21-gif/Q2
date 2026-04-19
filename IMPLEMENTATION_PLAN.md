# AI Migration Implementation Plan

## Overview
This document outlines the phased migration from Gemini to free/open AI alternatives with zero additional monthly costs.

## Phase 1: Immediate Migration (Week 1)
**Goal**: Replace Gemini with free alternatives while maintaining functionality

### 1.1 Server-Side Proxy Setup
**Files to Create:**
- `server/ai-proxy.js` - Express server with AI provider abstraction
- `server/package.json` - Dependencies for the proxy server
- `.env.example` - Environment variable template

**Code Changes:**
```javascript
// Add to src/App.jsx - Replace direct Gemini calls
const response = await fetch('/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: userInput,
    context: {
      inventory: inventoryContext,
      customers: customerContext,
      quote: quoteContext
    },
    history: chatHistory
  })
});
```

**Environment Variables to Add:**
```bash
# Choose one provider
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=deepseek/deepseek-chat

# OR
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_MODEL=deepseek-chat

# OR
AI_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama3-8b-8192
```

### 1.2 Provider Integration
**OpenRouter Setup:**
1. Sign up at https://openrouter.ai
2. Get API key from dashboard
3. Use DeepSeek model (free tier available)
4. Configure in `.env`

**DeepSeek Setup:**
1. Sign up at https://platform.deepseek.com
2. Get API key
3. Use DeepSeek Chat model
4. Configure in `.env`

**Groq Setup:**
1. Sign up at https://console.groq.com
2. Get API key
3. Use Llama 3 8B model (free tier)
4. Configure in `.env`

### 1.3 Testing & Validation
```bash
# Start the proxy server
cd server
npm install
npm start

# Test the API
curl -X POST http://localhost:3001/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"message": "Test message", "history": []}'
```

**Expected Response:**
```json
{
  "success": true,
  "response": "I'd be happy to help you...",
  "actions": [
    {
      "type": "ADD_TO_QUOTE",
      "sku": "ITEM-001",
      "quantity": 1
    }
  ],
  "provider": "openrouter"
}
```

## Phase 2: Local Hosting (Week 2)
**Goal**: Complete independence from external APIs using Ollama

### 2.1 Ollama Installation
**Hardware Requirements:**
- CPU: 4+ cores recommended
- RAM: 8GB minimum, 16GB recommended
- Storage: 10GB free space
- OS: Windows 10+, macOS 10.14+, or Linux

**Installation:**
```bash
# Download from https://ollama.ai
# Or using package manager
brew install ollama  # macOS
winget install Ollama.Ollama  # Windows
```

### 2.2 Model Setup
```bash
# Download recommended model
ollama pull llama3.1:8b

# Test the model
ollama run llama3.1:8b "Hello, how are you?"
```

**Configuration:**
```bash
# Add to .env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

### 2.3 Performance Optimization
```javascript
// Add to server/ai-proxy.js
const ollamaOptions = {
  temperature: 0.7,
  num_predict: 2000,
  num_ctx: 4096,
  repeat_penalty: 1.1
};
```

## Phase 3: Advanced Features (Week 3)
**Goal**: Enhance system with caching, rate limiting, and monitoring

### 3.1 Caching Implementation
```javascript
// Add Redis caching
const redis = require('redis');
const client = redis.createClient();

// Cache frequent requests
const cacheKey = `ai:${hash(message + JSON.stringify(context))}`;
const cached = await client.get(cacheKey);
if (cached) return JSON.parse(cached);
```

### 3.2 Rate Limiting
```javascript
// Enhanced rate limiting
const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many AI requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
```

### 3.3 Monitoring & Logging
```javascript
// Add comprehensive logging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'ai-proxy.log' }),
    new winston.transports.Console()
  ]
});
```

## Migration Steps

### Step 1: Backup Current System
```bash
# Backup current App.jsx
cp src/App.jsx src/App.jsx.backup

# Backup current environment
cp .env .env.backup
```

### Step 2: Install Proxy Server
```bash
# Create server directory
mkdir server
cd server

# Copy files from CLAUDE_PACKAGE/server/
cp ../CLAUDE_PACKAGE/server/* .

# Install dependencies
npm install
```

### Step 3: Update Client Code
```bash
# Apply the patch
git apply CLAUDE_PACKAGE/patches/client-migration.patch

# Or manually update src/App.jsx
# Replace lines 4192-4196 with fetch to /api/ai/generate
```

### Step 4: Configure Environment
```bash
# Copy environment template
cp CLAUDE_PACKAGE/env.example .env

# Edit .env with your API keys
nano .env
```

### Step 5: Test Migration
```bash
# Start proxy server
cd server
npm start

# Start client (in another terminal)
npm run dev

# Test AI functionality in browser
```

## Rollback Plan
If issues occur:
```bash
# Restore backup
cp src/App.jsx.backup src/App.jsx
cp .env.backup .env

# Restart client
npm run dev
```

## Cost Analysis

### Current (Gemini)
- Cost: ~$0.0015 per 1K tokens
- Monthly estimate: $50-200 depending on usage

### OpenRouter (Free Tier)
- Cost: Free tier available
- Models: DeepSeek, Llama variants
- Monthly estimate: $0

### DeepSeek (Direct)
- Cost: Free tier available
- Models: DeepSeek Chat
- Monthly estimate: $0

### Ollama (Local)
- Cost: Electricity only (~$5-10/month)
- Models: Any compatible model
- Monthly estimate: $5-10

### Groq (Free Tier)
- Cost: Free tier available
- Models: Llama 3, Mixtral
- Monthly estimate: $0

## Success Metrics
- ✅ API keys removed from client code
- ✅ Server-side proxy functional
- ✅ Action parsing tests pass (100%)
- ✅ Response time < 5 seconds
- ✅ Zero additional monthly costs
- ✅ Preserved user experience
- ✅ Enhanced security posture

## Troubleshooting

### Common Issues
1. **CORS Errors**: Ensure proxy server allows client origin
2. **API Key Issues**: Verify environment variables are set
3. **Model Not Found**: Check model name in provider documentation
4. **Rate Limiting**: Monitor usage and adjust limits
5. **Response Format**: Ensure provider returns expected format

### Debug Commands
```bash
# Check proxy health
curl http://localhost:3001/api/ai/health

# Test with sample data
curl -X POST http://localhost:3001/api/ai/generate \
  -H "Content-Type: application/json" \
  -d @CLAUDE_PACKAGE/samples/test-request.json

# Check logs
tail -f server/logs/ai-proxy.log
```

## Next Steps After Migration
1. Monitor performance and usage patterns
2. Optimize prompts for better responses
3. Add more sophisticated caching
4. Implement user feedback collection
5. Consider fine-tuning models for domain-specific tasks
