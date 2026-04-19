# Security Hardening Guide

## Overview
This document outlines security measures for the AI proxy server and client-side integration.

## Critical Security Issues Found

### 1. API Key Exposure (CRITICAL)
**Current Issue**: API keys are hardcoded in client-side code
```javascript
// src/App.jsx:4118 - EXPOSED!
const apiKey = "AIzaSyDSTOJuXixi0GrOyP0TPmasf7l2ku6I26c";
```

**Fix**: Move all API keys to server-side environment variables
```javascript
// Server-side only
const apiKey = process.env.OPENROUTER_API_KEY;
```

### 2. Input Sanitization
**Current Issue**: User input passed directly to AI without validation

**Fix**: Implement comprehensive input validation
```javascript
const validateInput = (input) => {
  // Remove potentially harmful content
  const sanitized = input
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove scripts
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
  
  // Validate length
  if (sanitized.length > 4000) {
    throw new Error('Input too long');
  }
  
  return sanitized;
};
```

### 3. Action Tag Validation
**Current Issue**: No validation of parsed action parameters

**Fix**: Implement strict validation
```javascript
const validateAction = (action) => {
  const validSKUs = /^[A-Z0-9\-_]+$/;
  const validQuantities = /^[1-9]\d{0,2}$/; // 1-999
  
  switch (action.type) {
    case 'ADD_TO_QUOTE':
    case 'REDUCE_QUOTE_QUANTITY':
      if (!validSKUs.test(action.sku)) {
        throw new Error('Invalid SKU format');
      }
      if (!validQuantities.test(action.quantity.toString())) {
        throw new Error('Invalid quantity');
      }
      break;
      
    case 'REMOVE_FROM_QUOTE':
      if (!validSKUs.test(action.sku)) {
        throw new Error('Invalid SKU format');
      }
      break;
      
    case 'SUGGEST_PRODUCTS':
      if (action.context.length > 200) {
        throw new Error('Context too long');
      }
      break;
      
    default:
      throw new Error('Unknown action type');
  }
};
```

## Server-Side Security Measures

### 1. Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests
  skipSuccessfulRequests: false,
  // Skip failed requests
  skipFailedRequests: false,
});
```

### 2. Input Validation Middleware
```javascript
const { body, validationResult } = require('express-validator');

const validateChatRequest = [
  body('message')
    .isString()
    .isLength({ min: 1, max: 4000 })
    .trim()
    .escape()
    .custom((value) => {
      // Check for malicious patterns
      const maliciousPatterns = [
        /<script[^>]*>/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /eval\s*\(/i,
        /document\.cookie/i,
        /window\.location/i
      ];
      
      for (const pattern of maliciousPatterns) {
        if (pattern.test(value)) {
          throw new Error('Potentially malicious input detected');
        }
      }
      return true;
    }),
  body('context').isObject().optional(),
  body('history').isArray().optional()
];
```

### 3. CORS Configuration
```javascript
const cors = require('cors');

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining']
}));
```

### 4. Helmet Security Headers
```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

## API Key Management

### 1. Environment Variables
```bash
# Never commit these to version control
OPENROUTER_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
GROQ_API_KEY=your_key_here

# Use different keys for different environments
OPENROUTER_API_KEY_DEV=dev_key_here
OPENROUTER_API_KEY_PROD=prod_key_here
```

### 2. Key Rotation
```javascript
// Implement key rotation
const rotateAPIKey = async () => {
  const currentKey = process.env.OPENROUTER_API_KEY;
  const backupKey = process.env.OPENROUTER_API_KEY_BACKUP;
  
  try {
    // Test backup key
    await testAPIKey(backupKey);
    
    // Switch to backup
    process.env.OPENROUTER_API_KEY = backupKey;
    process.env.OPENROUTER_API_KEY_BACKUP = currentKey;
    
    console.log('API key rotated successfully');
  } catch (error) {
    console.error('Key rotation failed:', error);
    throw error;
  }
};
```

### 3. Key Validation
```javascript
const validateAPIKey = async (provider, key) => {
  try {
    const testResponse = await fetch(`${AI_CONFIG.models[provider].baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!testResponse.ok) {
      throw new Error(`API key validation failed: ${testResponse.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('API key validation error:', error);
    return false;
  }
};
```

## Data Protection

### 1. PII Redaction
```javascript
const redactPII = (text) => {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED]') // Credit cards
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]') // SSN
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED]') // Emails
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED]'); // Phone numbers
};
```

### 2. Request Logging
```javascript
const logRequest = (req, res, next) => {
  const sanitizedBody = {
    ...req.body,
    message: req.body.message ? req.body.message.substring(0, 100) + '...' : undefined
  };
  
  console.log('AI Request:', {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: sanitizedBody
  });
  
  next();
};
```

### 3. Response Sanitization
```javascript
const sanitizeResponse = (response) => {
  // Remove any potential XSS vectors
  return response
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};
```

## Local Ollama Security

### 1. Network Binding
```bash
# Bind Ollama to localhost only
export OLLAMA_HOST=127.0.0.1:11434

# Or use environment variable
echo 'OLLAMA_HOST=127.0.0.1:11434' >> ~/.bashrc
```

### 2. Firewall Rules
```bash
# Block external access to Ollama port
sudo ufw deny 11434

# Allow only localhost
sudo ufw allow from 127.0.0.1 to any port 11434
```

### 3. User Permissions
```bash
# Run Ollama as non-root user
sudo useradd -r -s /bin/false ollama
sudo chown -R ollama:ollama /usr/share/ollama
sudo chown -R ollama:ollama ~/.ollama
```

## Monitoring & Alerting

### 1. Security Events
```javascript
const securityLogger = winston.createLogger({
  level: 'warn',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'security.log' }),
    new winston.transports.Console()
  ]
});

// Log security events
securityLogger.warn('Suspicious input detected', {
  ip: req.ip,
  input: req.body.message,
  timestamp: new Date().toISOString()
});
```

### 2. Rate Limit Alerts
```javascript
const alertOnRateLimit = (req, res, next) => {
  const key = `rate_limit_${req.ip}`;
  const attempts = req.rateLimit?.remaining || 0;
  
  if (attempts < 10) {
    securityLogger.warn('Rate limit approaching', {
      ip: req.ip,
      remaining: attempts,
      resetTime: req.rateLimit?.resetTime
    });
  }
  
  next();
};
```

### 3. API Key Usage Monitoring
```javascript
const monitorAPIUsage = async (provider, response) => {
  const usage = response.usage || {};
  
  if (usage.total_tokens > 10000) {
    securityLogger.warn('High token usage detected', {
      provider,
      tokens: usage.total_tokens,
      timestamp: new Date().toISOString()
    });
  }
};
```

## Deployment Security

### 1. HTTPS Only
```javascript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

### 2. Environment Isolation
```bash
# Use different environments
NODE_ENV=development  # Development
NODE_ENV=staging      # Staging
NODE_ENV=production   # Production

# Different API keys for each environment
OPENROUTER_API_KEY_DEV=dev_key
OPENROUTER_API_KEY_STAGING=staging_key
OPENROUTER_API_KEY_PROD=prod_key
```

### 3. Docker Security
```dockerfile
# Use non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

# Remove unnecessary packages
RUN apk del build-dependencies

# Use specific versions
FROM node:18-alpine3.18
```

## Security Checklist

### Before Deployment
- [ ] API keys moved to environment variables
- [ ] Input validation implemented
- [ ] Rate limiting configured
- [ ] CORS properly configured
- [ ] Security headers enabled
- [ ] PII redaction implemented
- [ ] Logging configured
- [ ] HTTPS enforced
- [ ] Firewall rules applied
- [ ] User permissions set correctly

### After Deployment
- [ ] Monitor security logs
- [ ] Test rate limiting
- [ ] Verify API key rotation
- [ ] Check for unusual usage patterns
- [ ] Validate response sanitization
- [ ] Test input validation
- [ ] Verify HTTPS enforcement
- [ ] Monitor error rates
- [ ] Check for failed authentication attempts
- [ ] Review access logs regularly

## Incident Response

### 1. API Key Compromise
```bash
# Immediate actions
1. Rotate compromised API key
2. Check usage logs for unauthorized access
3. Update environment variables
4. Restart services
5. Monitor for continued unauthorized access
```

### 2. Rate Limit Abuse
```bash
# Block abusive IPs
sudo ufw deny from <abusive_ip>

# Increase rate limits temporarily
# Monitor logs for patterns
# Consider implementing CAPTCHA
```

### 3. Malicious Input Detection
```bash
# Log the incident
# Block the IP if necessary
# Review input validation rules
# Update sanitization patterns
```

## Compliance Considerations

### 1. Data Retention
```javascript
// Implement data retention policies
const retentionPolicy = {
  logs: '90 days',
  requests: '30 days',
  errors: '1 year'
};

// Automatic cleanup
const cleanupOldData = async () => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  
  await Log.deleteMany({
    timestamp: { $lt: cutoffDate }
  });
};
```

### 2. Audit Trail
```javascript
// Maintain audit trail
const auditLog = {
  timestamp: new Date().toISOString(),
  action: 'AI_REQUEST',
  userId: req.user?.id,
  ip: req.ip,
  userAgent: req.get('User-Agent'),
  requestSize: JSON.stringify(req.body).length,
  responseTime: Date.now() - req.startTime
};
```

This security guide provides comprehensive protection for the AI proxy system while maintaining functionality and performance.
