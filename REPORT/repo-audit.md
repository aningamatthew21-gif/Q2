# Repository Audit Summary

## Stack Information
- **Frontend**: React 19.1.0 + Vite 7.0.4
- **Backend**: Node.js 18 + Firebase Functions
- **Package Manager**: npm
- **Build Tool**: Vite
- **Styling**: Tailwind CSS 4.1.11

## AI Integration Files

### Core AI Files
1. **`src/App.jsx`** (lines 4117-4256)
   - Contains Gemini API integration
   - System prompt definition (lines 4129-4188)
   - Action parsing logic (lines 4200-4247)
   - Message handling and chat UI

2. **`src/services/AIQuoteAssistant.js`**
   - Advanced AI service class for cost recommendations
   - Uses Gemini API for structured recommendations
   - JSON response parsing and validation

3. **`src/components/FormattedMessage.jsx`**
   - Markdown rendering for AI responses
   - Sanitization and security for AI content

### Firebase Configuration
- **`firebase.config.js`** - Firebase configuration
- **`functions/index.js`** - Cloud Functions (no AI integration found)
- **`functions/package.json`** - Functions dependencies

## System Prompt Location
**File**: `src/App.jsx` (lines 4129-4188)
**Function**: `handleSendMessage` within the QuotingModule component

The system prompt is dynamically constructed with:
- Core capabilities definition
- Action tag instructions
- Context data (inventory, customers, current quote)
- Recommendation logic

## Action Tag Parsing
**File**: `src/App.jsx` (lines 4200-4247)
**Function**: `handleSendMessage`

### Supported Actions:
1. `[ACTION:ADD_TO_QUOTE, SKU:ITEM_SKU, QUANTITY:NUMBER]`
2. `[ACTION:REMOVE_FROM_QUOTE, SKU:ITEM_SKU]`
3. `[ACTION:REDUCE_QUOTE_QUANTITY, SKU:ITEM_SKU, QUANTITY:NUMBER]`
4. `[ACTION:SUGGEST_PRODUCTS, CONTEXT:USER_REQUEST]`

### Parsing Implementation:
- Uses regex patterns for each action type
- Executes corresponding handler functions
- Removes action tags from display text
- Integrates with quote state management

## API Key Exposure Issues
**CRITICAL SECURITY ISSUES FOUND:**

1. **Client-side API Key**: `src/App.jsx` line 4118
   ```javascript
   const apiKey = "AIzaSyDSTOJuXixi0GrOyP0TPmasf7l2ku6I26c";
   ```
   - Gemini API key exposed in client code
   - Should be moved to server-side proxy

2. **Firebase API Key**: `src/App.jsx` lines 6605, 6741
   ```javascript
   apiKey: "AIzaSyCiRyWj3d9V0V_KwiNG7MxChUvKiqi6tDE"
   ```
   - Firebase API key (less critical, but should be in env)

## Database Models
**Firestore Collections** (from firebase.config.js):
- `customers` - Customer data
- `inventory` - Product inventory
- `invoices` - Invoice records
- `audit_logs` - System audit trail
- `settings` - Application settings

## Dependencies Analysis
### AI-Related Dependencies:
- `react-markdown` - Markdown rendering
- `remark-gfm` - GitHub Flavored Markdown
- `rehype-raw` - Raw HTML support
- `rehype-sanitize` - Content sanitization

### Missing Dependencies for Migration:
- No server-side AI proxy dependencies
- No alternative AI provider integrations
- No environment variable management

## Deployment Configuration
- **Firebase**: `firebase.json` - Firebase project configuration
- **Vite**: `vite.config.js` - Build configuration
- **ESLint**: `eslint.config.js` - Code linting
- **No Docker**: No containerization found
- **No CI/CD**: No GitHub Actions or deployment pipelines found

## Security Concerns
1. **API Keys in Client Code** - Critical vulnerability
2. **No Input Sanitization** - User input passed directly to AI
3. **No Rate Limiting** - No protection against abuse
4. **No Authentication** - AI endpoints not protected
5. **No Logging** - No audit trail for AI interactions

## Migration Requirements
1. **Server-side Proxy** - Move AI calls to backend
2. **Environment Variables** - Secure API key management
3. **Input Validation** - Sanitize user inputs
4. **Rate Limiting** - Protect against abuse
5. **Error Handling** - Robust error management
6. **Logging** - Audit trail for AI interactions

## File Structure
```
src/
├── App.jsx (main AI integration)
├── services/
│   └── AIQuoteAssistant.js (advanced AI service)
└── components/
    └── FormattedMessage.jsx (AI response rendering)

functions/
├── index.js (Firebase functions)
└── package.json (functions dependencies)
```

## Sample Data Sources
- No existing log files found for sample sessions
- Synthetic examples will be generated based on current prompt structure
- Real session data would need to be extracted from browser dev tools or server logs
