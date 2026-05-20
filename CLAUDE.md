# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the app (two processes required)

**Frontend** (Vite dev server on port 5173):
```
npm run dev
```

**Backend** (Express on port 3001 — run from the `backend/` directory):
```
cd backend && npm run dev
```
Or for production: `cd backend && npm start`

Vite proxies `/api/*` and `/socket.io/*` to `http://localhost:3001`, so both must be running during development.

### Other commands

```
npm run build          # Vite production build (frontend)
npm run lint           # ESLint (frontend)
npm run test           # Node built-in test runner on backend/permissions tests
cd backend && npm test # Jest full backend test suite
cd backend && npm run lint  # ESLint (backend)
```

The only automated tests are in `backend/__tests__/permissions.test.js`. They are pure unit tests with no DB/network dependencies and run in milliseconds.

## Environment

Backend config lives in `backend/.env` (not the repo root). Required variables:
- `DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_STRING` — Oracle XE (thin mode, no Instant Client)
- `JWT_SECRET`
- `SMTP_USER`, `SMTP_PASS` — Nodemailer for OTP email
- `OPENROUTER_API_KEY` — AI chat feature
- `FRONTEND_URL`, `PORT`

## Architecture Overview

### Two-layer app

**Frontend**: React 19 SPA built with Vite + Tailwind CSS v4. Custom SPA routing (not React Router — despite it being a dependency, routing is handled entirely by `AppContext`). State is managed through React Context + custom hooks.

**Backend**: Express.js + Oracle Database (oracledb v6 thin mode). All API routes live under `/api`. Real-time updates via Socket.IO.

### Frontend routing (`src/context/AppContext.jsx`)

There is no React Router in use. Navigation is a `page` string in React state. All authenticated pages are registered in a `switch` inside `renderPage()` and map to `case 'pageName': return <Component />`.

- Call `navigate(pageName)` from `useApp()` to change pages
- The `VALID_PAGES` set and `getPageFromURL()` sync state with `?page=` query params
- `canAccessPage(role, page)` gates rendering; unauthorised access shows `<Forbidden>`
- Two layouts: chromeless (login, customerPortal) vs `<AppShell>` (everything else)

### Permission system (`shared/permissions.js`)

Single source of truth used by **both** frontend and backend.

**Tiered roles**: `admin`, `finance_officer`, `finance_head`, `sales_officer`, `sales_head`, `procurement_officer`, `procurement_head`, `customer`

**Legacy roles** (stored in existing JWTs/DB): `controller` → `finance_head`, `sales` → `sales_officer`, `procurement` → `procurement_head`. Both the frontend `extractRole()` helper and the backend `authMiddleware` transparently upgrade legacy roles, so code never needs to handle both forms.

**Frontend usage**:
```js
import { can, canOpenPage } from '../utils/permissions';
can(appUser, 'invoice.approve.finance')   // accepts role string OR appUser object
canOpenPage(appUser, 'taxSettings')
```
The `<Can action="...">` component (`src/components/v2/Can.jsx`) gates JSX blocks. `PAGE_PERMISSIONS` maps page names to required actions.

**Backend usage**:
```js
router.post('/approve', authMiddleware, requirePermission('invoice.approve.finance'), handler);
```
`requirePermission` optionally runs Separation of Duties checks via `SOD_RULES`.

### Backend data layer (`backend/db.js`)

Exports two helpers — use these everywhere, never grab a raw pool connection:
- `execute(sql, binds)` — single statement, auto-commits
- `transaction(async fn)` — wraps multiple statements in a single transaction with automatic rollback on error

All Oracle rows come back as plain JS objects (`OUT_FORMAT_OBJECT`). CLOBs are auto-fetched as strings via `fetchTypeMap`. For legacy LOBs returned as streams use the exported `lobToString(lob)` helper.

### Audit logging

Two complementary mechanisms:
1. **`auditMiddleware`** (backend) — automatically logs every mutation (POST/PUT/PATCH/DELETE) to `QA_AUDIT_LOGS` after the response is sent. No frontend action required.
2. **`logActivity()`** (`src/utils/logger.js`) — frontend fire-and-forget POST to `/api/audit-logs` for semantic events (page views, explicit user actions). Use `useActivityLog()` hook for convenience in React components.

`auditMiddleware` skips `/api/audit-logs` to avoid recursion (skip check uses full path — do not strip `/api` prefix if editing `SKIP_ROUTES`).

### Real-time data hooks (`src/hooks/useRealtime*.js`)

Each hook (`useRealtimeInventory`, `useRealtimeInvoices`, etc.) follows the same pattern:
- Initial fetch on mount (shows loading state)
- Subscribes to a socket event (e.g. `inventory:updated`) that triggers a debounced refetch
- Refetches do **not** flip `loading` back to true — only the initial load shows a spinner

Connect the singleton socket (`src/socket.js`) with `socket.connect()` — it has `autoConnect: false`.

### UI component layers

There are two generations of UI components:
- `src/components/common/` — v1 components (Button, Card, Icon, PageHeader, etc.)
- `src/components/v2/` — Fluent 2 / Office-style redesign (AppShell, LeftNav, TopBar, DataTable, etc.)

Prefer v2 components for new work. The app shell is fully v2; some pages still use v1 components internally.

**Icon component** (`src/components/common/Icon.jsx`): maps FontAwesome IDs (e.g. `"trash"`, `"check-circle"`) to Lucide React components via `FA_TO_LUCIDE`. Unmapped IDs fall back to a FontAwesome `<i>` tag. Always use `<Icon id="..." />`, never import Lucide icons directly in pages.

### API client (`src/api.js`)

Axios instance with base URL `/api`. Automatically attaches the JWT from `localStorage`. On 401, removes the token from localStorage. New pages/routes use `api.get/post/put/delete`.

### Authentication

OTP-based (no passwords). Flow: `POST /auth/send-otp` → email OTP → `POST /auth/verify-otp` → JWT. The JWT payload contains `role` (may be legacy or tiered string) — `authMiddleware` normalises it to the tiered role before setting `req.user`.
