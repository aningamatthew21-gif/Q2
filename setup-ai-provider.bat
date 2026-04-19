@echo off
echo 🚀 Quote AI System - Provider Setup
echo ==================================
echo.

echo Choose your AI provider:
echo 1) Ollama (Local - 100%% Free, Unlimited)
echo 2) OpenRouter (Cloud - Free Tier, 10 req/min)
echo 3) Test Backend Only
echo.

set /p choice="Enter your choice [1-3]: "

if "%choice%"=="1" goto ollama_setup
if "%choice%"=="2" goto openrouter_setup
if "%choice%"=="3" goto test_backend
goto invalid_choice

:ollama_setup
echo.
echo 📦 Setting up Ollama (Local AI)...
echo.

echo Step 1: Install Ollama
echo Please download and install Ollama from: https://ollama.ai/download/windows
echo After installation, run: ollama serve
echo.
echo Step 2: Download AI Model
echo Run this command: ollama pull deepseek-r1:8b
echo.
echo Step 3: Configure Backend
echo Copy backend\env.example to backend\.env
echo Set AI_PROVIDER=ollama in backend\.env
echo.
echo Step 4: Start Services
echo Terminal 1: cd backend && npm start
echo Terminal 2: npm start
echo.
goto end

:openrouter_setup
echo.
echo ☁️ Setting up OpenRouter (Cloud AI)...
echo.

echo Step 1: Get API Key
echo 1. Go to: https://openrouter.ai
echo 2. Sign up for free account
echo 3. Get your API key from dashboard
echo.
echo Step 2: Configure Backend
echo 1. Copy backend\env.example to backend\.env
echo 2. Set AI_PROVIDER=openrouter
echo 3. Add your API key: OPENROUTER_API_KEY=your_key_here
echo.
echo Step 3: Start Services
echo Terminal 1: cd backend && npm start
echo Terminal 2: npm start
echo.
goto end

:test_backend
echo.
echo 🧪 Testing Backend Only...
echo.

echo Starting backend server...
cd backend
npm start
goto end

:invalid_choice
echo Invalid choice. Please run the script again.
goto end

:end
echo.
echo ✅ Setup instructions complete!
echo.
echo Next steps:
echo 1. Follow the provider-specific steps above
echo 2. Test your setup at: http://localhost:5173
echo 3. Check AI health at: http://localhost:3001/api/health
echo.
pause
