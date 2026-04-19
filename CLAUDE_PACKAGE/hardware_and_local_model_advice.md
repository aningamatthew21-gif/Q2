# Hardware Requirements & Local Model Setup Guide

## Overview
This guide covers setting up local AI models using Ollama for complete independence from external APIs and zero ongoing costs.

## Hardware Requirements

### Minimum Requirements
- **CPU**: 4 cores, 2.5GHz+
- **RAM**: 8GB (16GB recommended)
- **Storage**: 20GB free space
- **OS**: Windows 10+, macOS 10.14+, or Linux

### Recommended Configuration
- **CPU**: 8+ cores, 3.0GHz+
- **RAM**: 32GB (64GB for larger models)
- **Storage**: 50GB+ SSD
- **GPU**: NVIDIA RTX 3060+ (optional, for acceleration)
- **Network**: Stable internet for initial model download

### Enterprise/Production Setup
- **CPU**: 16+ cores, 3.5GHz+
- **RAM**: 128GB+
- **Storage**: 200GB+ NVMe SSD
- **GPU**: NVIDIA RTX 4090 or A100 (recommended)
- **Network**: Gigabit connection
- **Backup**: Redundant storage system

## Model Recommendations

### 1. Llama 3.1 8B (Recommended)
```bash
# Download and run
ollama pull llama3.1:8b
ollama run llama3.1:8b "Hello, how are you?"
```

**Specifications:**
- Size: ~4.7GB
- RAM Usage: ~8GB
- Performance: Excellent for most tasks
- Speed: Fast response times
- Quality: High-quality responses

### 2. Llama 3.1 70B (High Quality)
```bash
# Download and run
ollama pull llama3.1:70b
ollama run llama3.1:70b "Hello, how are you?"
```

**Specifications:**
- Size: ~40GB
- RAM Usage: ~80GB
- Performance: Excellent quality
- Speed: Slower but very high quality
- Quality: Best available

### 3. Mistral 7B (Balanced)
```bash
# Download and run
ollama pull mistral:7b
ollama run mistral:7b "Hello, how are you?"
```

**Specifications:**
- Size: ~4.1GB
- RAM Usage: ~8GB
- Performance: Good balance
- Speed: Fast
- Quality: Good quality

### 4. CodeLlama 7B (Code-Focused)
```bash
# Download and run
ollama pull codellama:7b
ollama run codellama:7b "Write a Python function to calculate fibonacci numbers"
```

**Specifications:**
- Size: ~3.8GB
- RAM Usage: ~8GB
- Performance: Excellent for code
- Speed: Fast
- Quality: Specialized for programming

## Installation Guide

### Windows Installation
```powershell
# Download from https://ollama.ai
# Or using winget
winget install Ollama.Ollama

# Start the service
ollama serve

# Download a model
ollama pull llama3.1:8b

# Test the installation
ollama run llama3.1:8b "Test message"
```

### macOS Installation
```bash
# Download from https://ollama.ai
# Or using Homebrew
brew install ollama

# Start the service
ollama serve

# Download a model
ollama pull llama3.1:8b

# Test the installation
ollama run llama3.1:8b "Test message"
```

### Linux Installation
```bash
# Download and install
curl -fsSL https://ollama.ai/install.sh | sh

# Start the service
ollama serve

# Download a model
ollama pull llama3.1:8b

# Test the installation
ollama run llama3.1:8b "Test message"
```

### Docker Installation
```bash
# Run Ollama in Docker
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama

# Download a model
docker exec -it ollama ollama pull llama3.1:8b

# Test the installation
docker exec -it ollama ollama run llama3.1:8b "Test message"
```

## Configuration

### Environment Variables
```bash
# Set Ollama host
export OLLAMA_HOST=127.0.0.1:11434

# Set model directory
export OLLAMA_MODELS=/path/to/models

# Set number of GPU layers (if using GPU)
export OLLAMA_NUM_GPU_LAYERS=32

# Set context length
export OLLAMA_NUM_CTX=4096
```

### Systemd Service (Linux)
```ini
# /etc/systemd/system/ollama.service
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NUM_GPU_LAYERS=32"

[Install]
WantedBy=default.target
```

```bash
# Enable and start the service
sudo systemctl enable ollama
sudo systemctl start ollama
sudo systemctl status ollama
```

## Performance Optimization

### CPU Optimization
```bash
# Set CPU affinity
taskset -c 0-7 ollama serve

# Set process priority
nice -n -10 ollama serve

# Use specific CPU cores
numactl --cpunodebind=0 ollama serve
```

### Memory Optimization
```bash
# Set memory limits
ulimit -v 16777216  # 16GB virtual memory

# Use memory mapping
export OLLAMA_MMAP=1

# Set swap usage
export OLLAMA_SWAP_USAGE=0.5
```

### GPU Acceleration (NVIDIA)
```bash
# Install NVIDIA drivers
# Install CUDA toolkit
# Install Ollama with GPU support

# Set GPU layers
export OLLAMA_NUM_GPU_LAYERS=32

# Verify GPU usage
nvidia-smi
```

## Model Fine-tuning

### Custom Model Creation
```bash
# Create a Modelfile
cat > Modelfile << EOF
FROM llama3.1:8b

# Set system prompt
SYSTEM """
You are an intelligent sales assistant for Margins ID Systems.
You help customers with product recommendations and quote management.
Always be helpful, professional, and accurate.
"""

# Set parameters
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
PARAMETER num_predict 2000
PARAMETER repeat_penalty 1.1
EOF

# Create custom model
ollama create sales-assistant -f Modelfile

# Test custom model
ollama run sales-assistant "Hello, I need help with a quote"
```

### Model Quantization
```bash
# Download quantized models (smaller, faster)
ollama pull llama3.1:8b-instruct-q4_0  # 4-bit quantization
ollama pull llama3.1:8b-instruct-q8_0  # 8-bit quantization

# Compare performance
time ollama run llama3.1:8b "Test message"
time ollama run llama3.1:8b-instruct-q4_0 "Test message"
```

## Monitoring & Maintenance

### Performance Monitoring
```bash
# Monitor resource usage
htop
nvidia-smi  # If using GPU
iotop       # Disk I/O monitoring

# Monitor Ollama logs
journalctl -u ollama -f

# Check model status
ollama list
ollama ps
```

### Health Checks
```bash
# Create health check script
cat > health_check.sh << 'EOF'
#!/bin/bash

# Check if Ollama is running
if ! pgrep -f "ollama serve" > /dev/null; then
    echo "ERROR: Ollama is not running"
    exit 1
fi

# Check if API is responding
if ! curl -s http://localhost:11434/api/version > /dev/null; then
    echo "ERROR: Ollama API is not responding"
    exit 1
fi

# Check if model is loaded
if ! curl -s http://localhost:11434/api/ps | grep -q "llama3.1:8b"; then
    echo "WARNING: Model not loaded, loading now..."
    ollama run llama3.1:8b "Health check" > /dev/null 2>&1
fi

echo "OK: Ollama is healthy"
EOF

chmod +x health_check.sh
./health_check.sh
```

### Automated Model Loading
```bash
# Create startup script
cat > start_models.sh << 'EOF'
#!/bin/bash

# Load essential models on startup
ollama run llama3.1:8b "Startup check" > /dev/null 2>&1
ollama run mistral:7b "Startup check" > /dev/null 2>&1

echo "Models loaded successfully"
EOF

chmod +x start_models.sh

# Add to crontab for automatic startup
echo "@reboot /path/to/start_models.sh" | crontab -
```

## Security Configuration

### Network Security
```bash
# Bind to localhost only
export OLLAMA_HOST=127.0.0.1:11434

# Use firewall rules
sudo ufw allow from 127.0.0.1 to any port 11434
sudo ufw deny 11434

# Use reverse proxy for external access
# nginx configuration
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://127.0.0.1:11434;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### User Permissions
```bash
# Create dedicated user
sudo useradd -r -s /bin/false ollama
sudo chown -R ollama:ollama /usr/local/bin/ollama
sudo chown -R ollama:ollama ~/.ollama

# Run as non-root
sudo -u ollama ollama serve
```

## Troubleshooting

### Common Issues

#### 1. Out of Memory
```bash
# Check memory usage
free -h
ps aux --sort=-%mem | head

# Solutions:
# - Reduce model size
# - Increase swap space
# - Close other applications
# - Use quantized models
```

#### 2. Slow Performance
```bash
# Check CPU usage
top
htop

# Solutions:
# - Use GPU acceleration
# - Increase CPU cores
# - Use quantized models
# - Optimize system settings
```

#### 3. Model Not Loading
```bash
# Check model status
ollama list
ollama ps

# Solutions:
# - Restart Ollama service
# - Re-download model
# - Check disk space
# - Verify permissions
```

#### 4. API Connection Issues
```bash
# Test API connectivity
curl -v http://localhost:11434/api/version

# Solutions:
# - Check if Ollama is running
# - Verify port configuration
# - Check firewall rules
# - Restart service
```

### Performance Benchmarks

#### Response Time Tests
```bash
# Test response times
time ollama run llama3.1:8b "Write a short story about a robot"
time ollama run mistral:7b "Write a short story about a robot"
time ollama run codellama:7b "Write a Python function to sort a list"
```

#### Memory Usage Tests
```bash
# Monitor memory usage during inference
while true; do
    ps aux | grep ollama | grep -v grep
    sleep 1
done
```

## Cost Analysis

### Hardware Costs
- **Basic Setup**: $500-1000 (CPU, RAM, storage)
- **Recommended Setup**: $1500-3000 (CPU, RAM, SSD, GPU)
- **Enterprise Setup**: $5000+ (Server-grade hardware)

### Operating Costs
- **Electricity**: $10-50/month (depending on usage)
- **Internet**: Existing connection
- **Maintenance**: Minimal
- **Total Monthly**: $10-50 (vs $50-200 for API services)

### ROI Calculation
```
Monthly API Cost: $100
Monthly Local Cost: $30
Monthly Savings: $70
Annual Savings: $840
Hardware Payback: 6-12 months
```

## Migration Strategy

### Phase 1: Testing
1. Install Ollama on development machine
2. Test with sample data
3. Compare responses with current system
4. Validate performance requirements

### Phase 2: Staging
1. Deploy to staging environment
2. Run full test suite
3. Performance testing
4. User acceptance testing

### Phase 3: Production
1. Deploy to production server
2. Configure monitoring
3. Set up automated backups
4. Train support team

### Fallback Plan
1. Keep external API as backup
2. Implement automatic failover
3. Monitor local system health
4. Maintain API keys for emergency use

This comprehensive guide ensures successful deployment of local AI models with optimal performance and security.
