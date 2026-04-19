# AI Migration Package for Claude

## Executive Summary

This package contains everything needed to migrate the current Gemini-based AI integration to free/open alternatives (OpenRouter/DeepSeek/Ollama) with **zero additional monthly costs**.

## Current System Analysis

**Stack**: React 19.1.0 + Node.js 18 + Firebase Functions  
**Current AI Provider**: Google Gemini (gemini-2.5-flash-preview-05-20)  
**Critical Issue**: API key exposed in client code (`src/App.jsx:4118`)

## Package Contents

### 1. Core Files
- **`server/ai-proxy.js`** - Server-side proxy to hide API keys
- **`prompts/system_prompt.txt`** - Extracted current system prompt
- **`.env.example`** - Required environment variables
- **`patches/*.patch`** - Minimal code changes for migration

### 2. Testing & Validation
- **`tests/`** - Jest unit tests for action parsing and API mocking
- **`QA_CHECKLIST.md`** - Manual testing procedures
- **`samples/`** - Example AI conversations (synthetic)

### 3. Implementation Guidance
- **`IMPLEMENTATION_PLAN.md`** - Phased migration approach
- **`SECURITY.md`** - Security hardening recommendations
- **`deployment_instructions.md`** - Step-by-step deployment
- **`OBSERVABILITY.md`** - Logging and monitoring setup

### 4. Hardware & Local Options
- **`hardware_and_local_model_advice.md`** - Ollama setup for local hosting

## Quick Start for Claude

Use this exact prompt when calling Claude:

> "Claude — I'm handing you `CLAUDE_PACKAGE.zip` produced by Cursor. It contains: repo audit, AI prompts, server proxy skeleton, tests, sample sessions, and implementation plan. Use these artifacts to produce a complete, production-ready migration from Gemini to a free/open alternative (OpenRouter/DeepSeek/Ollama). Outputs required: final code diffs, hardened system prompt, action JSON schema, unit tests, `.env.example`, and deployment instructions. Important constraints: no extra monthly cost, do not put API keys in client code, preserve existing [ACTION:...] tag format. See `CLAUDE_PACKAGE/README.md` for file list."

## File Citations for Claude

**Core Implementation Files:**
- `REPORT/repo-audit.md` - Complete system analysis
- `CLAUDE_PACKAGE/server/ai-proxy.js` - Server proxy skeleton
- `CLAUDE_PACKAGE/prompts/system_prompt.txt` - Current AI prompt
- `CLAUDE_PACKAGE/patches/client-migration.patch` - Client changes
- `CLAUDE_PACKAGE/tests/action-parsing.test.js` - Action parsing tests
- `CLAUDE_PACKAGE/samples/sample-sessions.json` - Example conversations

**Configuration & Deployment:**
- `CLAUDE_PACKAGE/.env.example` - Environment variables
- `CLAUDE_PACKAGE/deployment_instructions.md` - Deployment steps
- `CLAUDE_PACKAGE/SECURITY.md` - Security hardening
- `CLAUDE_PACKAGE/IMPLEMENTATION_PLAN.md` - Migration phases

## Key Constraints

1. **No Monthly Costs** - Use only free tiers or local hosting
2. **Server-side Only** - Move all AI calls to backend
3. **Preserve Actions** - Keep existing `[ACTION:...]` tag format
4. **Security First** - Remove API keys from client code
5. **Zero Downtime** - Phased migration approach

## Migration Phases

1. **Immediate**: Server proxy + OpenRouter/DeepSeek integration
2. **Short-term**: Local Ollama setup for complete independence
3. **Mid-term**: Advanced features (caching, embeddings, rate limiting)

## Success Criteria

- ✅ API keys removed from client code
- ✅ Server-side AI proxy functional
- ✅ Action parsing tests pass
- ✅ Zero additional monthly costs
- ✅ Preserved user experience
- ✅ Enhanced security posture
