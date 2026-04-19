# Observability & Monitoring Guide

## Overview
This guide covers comprehensive monitoring, logging, and alerting for the AI proxy system to ensure reliability and performance.

## Logging Strategy

### 1. Structured Logging
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ai-proxy' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

### 2. Request Logging
```javascript
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('Request received', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.headers['x-request-id'] || generateId(),
    timestamp: new Date().toISOString()
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.headers['x-request-id'],
      timestamp: new Date().toISOString()
    });
  });
  
  next();
};
```

### 3. AI Interaction Logging
```javascript
const logAIInteraction = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (req.url.includes('/api/ai/generate')) {
      const responseData = JSON.parse(data);
      
      logger.info('AI interaction', {
        requestId: req.headers['x-request-id'],
        provider: responseData.provider,
        messageLength: req.body.message?.length || 0,
        responseLength: responseData.response?.length || 0,
        actionsCount: responseData.actions?.length || 0,
        success: responseData.success,
        timestamp: new Date().toISOString()
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
};
```

### 4. Error Logging
```javascript
const errorLogger = (error, req, res, next) => {
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    ip: req.ip,
    requestId: req.headers['x-request-id'],
    timestamp: new Date().toISOString()
  });
  
  next(error);
};
```

## Metrics Collection

### 1. Application Metrics
```javascript
const prometheus = require('prom-client');

// Create metrics registry
const register = new prometheus.Registry();

// Add default metrics
prometheus.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestsTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  registers: [register]
});

const aiRequestsTotal = new prometheus.Counter({
  name: 'ai_requests_total',
  help: 'Total number of AI requests',
  labelNames: ['provider', 'status'],
  registers: [register]
});

const aiRequestDuration = new prometheus.Histogram({
  name: 'ai_request_duration_seconds',
  help: 'Duration of AI requests in seconds',
  labelNames: ['provider'],
  registers: [register]
});

const aiTokensUsed = new prometheus.Counter({
  name: 'ai_tokens_used_total',
  help: 'Total tokens used by AI providers',
  labelNames: ['provider', 'type'],
  registers: [register]
});
```

### 2. System Metrics
```javascript
const os = require('os');

const systemMetrics = new prometheus.Gauge({
  name: 'system_memory_usage_bytes',
  help: 'System memory usage in bytes',
  registers: [register]
});

const cpuUsage = new prometheus.Gauge({
  name: 'system_cpu_usage_percent',
  help: 'System CPU usage percentage',
  registers: [register]
});

// Update system metrics every 30 seconds
setInterval(() => {
  const memUsage = process.memoryUsage();
  systemMetrics.set(memUsage.heapUsed);
  
  const cpuUsage = process.cpuUsage();
  cpuUsage.set(cpuUsage.user / 1000000); // Convert to seconds
}, 30000);
```

### 3. Business Metrics
```javascript
const quoteActionsTotal = new prometheus.Counter({
  name: 'quote_actions_total',
  help: 'Total number of quote actions',
  labelNames: ['action_type'],
  registers: [register]
});

const activeUsers = new prometheus.Gauge({
  name: 'active_users_total',
  help: 'Number of active users',
  registers: [register]
});

const quoteConversionRate = new prometheus.Gauge({
  name: 'quote_conversion_rate',
  help: 'Quote conversion rate',
  registers: [register]
});
```

## Health Checks

### 1. Basic Health Check
```javascript
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  };
  
  res.json(health);
});
```

### 2. Detailed Health Check
```javascript
app.get('/health/detailed', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {}
  };
  
  // Check AI provider
  try {
    const provider = createAIProvider(AI_CONFIG.provider);
    const testResponse = await provider.generateResponse([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say "OK" if you can respond.' }
    ]);
    
    health.checks.ai_provider = {
      status: 'healthy',
      provider: AI_CONFIG.provider,
      response_time: '< 5s'
    };
  } catch (error) {
    health.checks.ai_provider = {
      status: 'unhealthy',
      provider: AI_CONFIG.provider,
      error: error.message
    };
    health.status = 'unhealthy';
  }
  
  // Check database connection (if applicable)
  health.checks.database = {
    status: 'healthy',
    connection: 'active'
  };
  
  // Check memory usage
  const memUsage = process.memoryUsage();
  health.checks.memory = {
    status: memUsage.heapUsed < 512 * 1024 * 1024 ? 'healthy' : 'warning',
    heap_used: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heap_total: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
  };
  
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

### 3. Readiness Check
```javascript
app.get('/ready', async (req, res) => {
  const readiness = {
    ready: true,
    timestamp: new Date().toISOString(),
    checks: {}
  };
  
  // Check if AI provider is ready
  try {
    const provider = createAIProvider(AI_CONFIG.provider);
    await provider.generateResponse([
      { role: 'user', content: 'Test' }
    ]);
    
    readiness.checks.ai_provider = 'ready';
  } catch (error) {
    readiness.checks.ai_provider = 'not_ready';
    readiness.ready = false;
  }
  
  // Check if required environment variables are set
  const requiredEnvVars = ['AI_PROVIDER'];
  requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
      readiness.checks[envVar] = 'not_ready';
      readiness.ready = false;
    } else {
      readiness.checks[envVar] = 'ready';
    }
  });
  
  const statusCode = readiness.ready ? 200 : 503;
  res.status(statusCode).json(readiness);
});
```

## Alerting

### 1. Alert Rules
```yaml
# alerting-rules.yml
groups:
- name: ai-proxy-alerts
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status_code=~"5.."}[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} requests per second"
  
  - alert: AIProviderDown
    expr: up{job="ai-provider"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "AI provider is down"
      description: "AI provider has been down for more than 1 minute"
  
  - alert: HighResponseTime
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 10
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High response time"
      description: "95th percentile response time is {{ $value }} seconds"
  
  - alert: HighMemoryUsage
    expr: system_memory_usage_bytes > 1024*1024*1024
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage"
      description: "Memory usage is {{ $value }} bytes"
  
  - alert: RateLimitExceeded
    expr: rate(http_requests_total{status_code="429"}[5m]) > 0.01
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: "Rate limit exceeded"
      description: "Rate limit exceeded {{ $value }} times per second"
```

### 2. Alert Manager Configuration
```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'localhost:587'
  smtp_from: 'alerts@your-domain.com'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'

receivers:
- name: 'web.hook'
  webhook_configs:
  - url: 'http://localhost:5001/webhook'
    send_resolved: true

- name: 'email'
  email_configs:
  - to: 'admin@your-domain.com'
    subject: 'AI Proxy Alert: {{ .GroupLabels.alertname }}'
    body: |
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Description: {{ .Annotations.description }}
      {{ end }}
```

### 3. Custom Alerting Logic
```javascript
const alerting = {
  errorRate: 0,
  lastAlert: new Date(),
  
  checkErrorRate: (errorCount, totalRequests) => {
    const errorRate = errorCount / totalRequests;
    
    if (errorRate > 0.1 && Date.now() - this.lastAlert > 300000) { // 5 minutes
      this.sendAlert('High Error Rate', `Error rate is ${errorRate.toFixed(2)}`);
      this.lastAlert = new Date();
    }
  },
  
  sendAlert: (title, message) => {
    // Send alert via webhook, email, or Slack
    logger.warn('Alert triggered', { title, message });
    
    // Example webhook alert
    fetch(process.env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        message,
        timestamp: new Date().toISOString(),
        severity: 'warning'
      })
    }).catch(error => {
      logger.error('Failed to send alert', { error: error.message });
    });
  }
};
```

## Dashboard Configuration

### 1. Grafana Dashboard
```json
{
  "dashboard": {
    "title": "AI Proxy Dashboard",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{route}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "AI Provider Status",
        "type": "stat",
        "targets": [
          {
            "expr": "up{job=\"ai-provider\"}",
            "legendFormat": "Provider Status"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status_code=~\"5..\"}[5m])",
            "legendFormat": "Error Rate"
          }
        ]
      }
    ]
  }
}
```

### 2. Custom Dashboard
```javascript
app.get('/dashboard', (req, res) => {
  const dashboard = {
    title: 'AI Proxy Dashboard',
    timestamp: new Date().toISOString(),
    metrics: {
      requests: {
        total: httpRequestsTotal,
        errors: errorCount,
        rate: requestRate
      },
      ai: {
        requests: aiRequestCount,
        providers: providerStats,
        tokens: tokenUsage
      },
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      }
    }
  };
  
  res.json(dashboard);
});
```

## Log Analysis

### 1. Log Aggregation
```javascript
const logAggregation = {
  // Aggregate logs by time period
  aggregateByTime: (logs, timePeriod) => {
    const aggregated = {};
    
    logs.forEach(log => {
      const timeKey = new Date(log.timestamp).toISOString().substring(0, timePeriod);
      
      if (!aggregated[timeKey]) {
        aggregated[timeKey] = {
          count: 0,
          errors: 0,
          avgResponseTime: 0
        };
      }
      
      aggregated[timeKey].count++;
      
      if (log.level === 'error') {
        aggregated[timeKey].errors++;
      }
      
      if (log.duration) {
        aggregated[timeKey].avgResponseTime += log.duration;
      }
    });
    
    return aggregated;
  },
  
  // Analyze error patterns
  analyzeErrors: (logs) => {
    const errors = logs.filter(log => log.level === 'error');
    const errorPatterns = {};
    
    errors.forEach(error => {
      const pattern = error.message.substring(0, 50);
      
      if (!errorPatterns[pattern]) {
        errorPatterns[pattern] = {
          count: 0,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp
        };
      }
      
      errorPatterns[pattern].count++;
      errorPatterns[pattern].lastSeen = error.timestamp;
    });
    
    return errorPatterns;
  }
};
```

### 2. Performance Analysis
```javascript
const performanceAnalysis = {
  // Analyze response times
  analyzeResponseTimes: (logs) => {
    const responseTimes = logs
      .filter(log => log.duration)
      .map(log => log.duration);
    
    return {
      min: Math.min(...responseTimes),
      max: Math.max(...responseTimes),
      avg: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      p95: responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)],
      p99: responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.99)]
    };
  },
  
  // Analyze AI provider performance
  analyzeProviderPerformance: (logs) => {
    const providerStats = {};
    
    logs.forEach(log => {
      if (log.provider) {
        if (!providerStats[log.provider]) {
          providerStats[log.provider] = {
            requests: 0,
            errors: 0,
            totalResponseTime: 0
          };
        }
        
        providerStats[log.provider].requests++;
        
        if (log.success === false) {
          providerStats[log.provider].errors++;
        }
        
        if (log.responseTime) {
          providerStats[log.provider].totalResponseTime += log.responseTime;
        }
      }
    });
    
    // Calculate averages
    Object.keys(providerStats).forEach(provider => {
      const stats = providerStats[provider];
      stats.avgResponseTime = stats.totalResponseTime / stats.requests;
      stats.errorRate = stats.errors / stats.requests;
    });
    
    return providerStats;
  }
};
```

## Monitoring Best Practices

### 1. Key Metrics to Monitor
- **Response Time**: 95th percentile < 5 seconds
- **Error Rate**: < 1% of total requests
- **Availability**: > 99.9% uptime
- **Memory Usage**: < 80% of available memory
- **CPU Usage**: < 70% of available CPU
- **Rate Limiting**: Monitor 429 responses

### 2. Alert Thresholds
- **Critical**: Service down, error rate > 5%
- **Warning**: Response time > 10s, error rate > 1%
- **Info**: High usage, rate limiting triggered

### 3. Log Retention
- **Application Logs**: 30 days
- **Error Logs**: 90 days
- **Access Logs**: 7 days
- **Audit Logs**: 1 year

### 4. Performance Optimization
- **Log Rotation**: Daily rotation, compress old logs
- **Log Sampling**: Sample high-volume logs
- **Metric Aggregation**: Aggregate metrics by time period
- **Alert Throttling**: Prevent alert spam

This comprehensive observability guide ensures reliable monitoring and alerting for the AI proxy system.
