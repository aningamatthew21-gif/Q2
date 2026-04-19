/**
 * AI Proxy Server - Migrates from Gemini to free/open alternatives
 * Supports: OpenRouter, DeepSeek, Ollama, Groq
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: process.env.MAX_REQUEST_SIZE || '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/ai', limiter);

// AI Provider Configuration
const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || 'openrouter',
  models: {
    openrouter: {
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'
    },
    deepseek: {
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
      apiKey: null // No API key needed for Ollama
    },
    groq: {
      baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'llama3-8b-8192'
    }
  }
};

// Load system prompt
let systemPrompt = '';
async function loadSystemPrompt() {
  try {
    systemPrompt = await fs.readFile(path.join(__dirname, '../prompts/system_prompt.txt'), 'utf8');
  } catch (error) {
    console.error('Failed to load system prompt:', error);
    systemPrompt = 'You are a helpful sales assistant.';
  }
}

// Input validation
const validateChatRequest = [
  body('message').isString().isLength({ min: 1, max: 4000 }).trim(),
  body('context').isObject().optional(),
  body('history').isArray().optional()
];

// AI Provider Adapters
class AIProvider {
  constructor(config) {
    this.config = config;
  }

  async generateResponse(messages, context = {}) {
    throw new Error('Abstract method - implement in subclass');
  }
}

class OpenRouterProvider extends AIProvider {
  async generateResponse(messages, context = {}) {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Margins ID Systems'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

class DeepSeekProvider extends AIProvider {
  async generateResponse(messages, context = {}) {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

class OllamaProvider extends AIProvider {
  async generateResponse(messages, context = {}) {
    // Convert OpenAI format to Ollama format
    const prompt = messages.map(msg => {
      return `${msg.role}: ${msg.content}`;
    }).join('\n\n') + '\n\nassistant:';

    const response = await fetch(`${this.config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 2000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }
}

class GroqProvider extends AIProvider {
  async generateResponse(messages, context = {}) {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

// Provider factory
function createAIProvider(providerName) {
  const config = AI_CONFIG.models[providerName];
  if (!config) {
    throw new Error(`Unknown AI provider: ${providerName}`);
  }

  switch (providerName) {
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'groq':
      return new GroqProvider(config);
    default:
      throw new Error(`Unsupported provider: ${providerName}`);
  }
}

// Action tag parsing (preserve existing format)
function parseActionTags(text) {
  const actions = [];
  const patterns = {
    addToQuote: /\[ACTION:ADD_TO_QUOTE, SKU:(.*?), QUANTITY:(\d+)\]/g,
    removeFromQuote: /\[ACTION:REMOVE_FROM_QUOTE, SKU:(.*?)\]/g,
    reduceQuantity: /\[ACTION:REDUCE_QUOTE_QUANTITY, SKU:(.*?), QUANTITY:(\d+)\]/g,
    suggestProducts: /\[ACTION:SUGGEST_PRODUCTS, CONTEXT:(.*?)\]/g
  };

  let cleanText = text;
  let match;

  // Parse ADD_TO_QUOTE actions
  while ((match = patterns.addToQuote.exec(text)) !== null) {
    actions.push({
      type: 'ADD_TO_QUOTE',
      sku: match[1].trim(),
      quantity: parseInt(match[2], 10)
    });
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse REMOVE_FROM_QUOTE actions
  while ((match = patterns.removeFromQuote.exec(text)) !== null) {
    actions.push({
      type: 'REMOVE_FROM_QUOTE',
      sku: match[1].trim()
    });
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse REDUCE_QUOTE_QUANTITY actions
  while ((match = patterns.reduceQuantity.exec(text)) !== null) {
    actions.push({
      type: 'REDUCE_QUOTE_QUANTITY',
      sku: match[1].trim(),
      quantity: parseInt(match[2], 10)
    });
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse SUGGEST_PRODUCTS actions
  while ((match = patterns.suggestProducts.exec(text)) !== null) {
    actions.push({
      type: 'SUGGEST_PRODUCTS',
      context: match[1].trim()
    });
    cleanText = cleanText.replace(match[0], '');
  }

  return { actions, cleanText: cleanText.trim() };
}

// Main AI endpoint
app.post('/api/ai/generate', validateChatRequest, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        details: errors.array() 
      });
    }

    const { message, context = {}, history = [] } = req.body;

    // Build messages array
    const messages = [
      {
        role: 'system',
        content: systemPrompt.replace(/\{INVENTORY_CONTEXT\}/g, context.inventory || 'No inventory data')
                            .replace(/\{CUSTOMER_CONTEXT\}/g, context.customers || 'No customer data')
                            .replace(/\{QUOTE_CONTEXT\}/g, context.quote || 'No quote data')
      },
      ...history,
      {
        role: 'user',
        content: message
      }
    ];

    // Get AI provider
    const provider = createAIProvider(AI_CONFIG.provider);

    // Generate response
    const responseText = await provider.generateResponse(messages, context);

    // Parse action tags
    const { actions, cleanText } = parseActionTags(responseText);

    // Log the interaction (for audit trail)
    console.log('AI Request:', {
      timestamp: new Date().toISOString(),
      message: message.substring(0, 100) + '...',
      provider: AI_CONFIG.provider,
      actionsCount: actions.length
    });

    res.json({
      success: true,
      response: cleanText,
      actions: actions,
      provider: AI_CONFIG.provider
    });

  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'AI service temporarily unavailable',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get('/api/ai/health', async (req, res) => {
  try {
    const provider = createAIProvider(AI_CONFIG.provider);
    
    // Test with a simple message
    const testMessages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say "OK" if you can respond.' }
    ];
    
    const response = await provider.generateResponse(testMessages);
    
    res.json({
      status: 'healthy',
      provider: AI_CONFIG.provider,
      response: response.substring(0, 50)
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      provider: AI_CONFIG.provider,
      error: error.message
    });
  }
});

// Provider info endpoint
app.get('/api/ai/providers', (req, res) => {
  res.json({
    current: AI_CONFIG.provider,
    available: Object.keys(AI_CONFIG.models),
    models: AI_CONFIG.models
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
async function startServer() {
  await loadSystemPrompt();
  
  app.listen(PORT, () => {
    console.log(`AI Proxy Server running on port ${PORT}`);
    console.log(`Provider: ${AI_CONFIG.provider}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

module.exports = app;
