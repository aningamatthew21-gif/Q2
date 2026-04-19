# QA_PROCUREMENT_EVENTS — Payload Schema Reference

Every row in `QA_PROCUREMENT_EVENTS` is one immutable procurement-lifecycle event.
The `PAYLOAD` column is a CLOB holding JSON. Shape depends on `EVENT_TYPE`.
This file is the canonical reference for any reporting / BI consumer (Phase 5+).

## Table columns

| Column | Type | Notes |
|---|---|---|
| `EVENT_ID` | `NUMBER` (seq) | Auto-increment primary key |
| `EVENT_TIME` | `TIMESTAMP` | Server clock at insert |
| `EVENT_TYPE` | `VARCHAR2(50)` | One of the types below |
| `ENTITY_TYPE` | `VARCHAR2(20)` | `PR`, `RFQ`, `INVOICE`, `VENDOR`, `RESPONSE`, or `SETTING` |
| `ENTITY_ID` | `VARCHAR2(255)` | Foreign reference (PR_ID, RFQ_ID, INVOICE_ID…) |
| `ACTOR` | `VARCHAR2(255)` | Email of the user, or `'system'` / `'stalenessWatcher'` |
| `PAYLOAD` | `CLOB` (JSON) | See per-event schemas below |

Reporting queries should always filter by `ENTITY_TYPE` **and** `EVENT_TYPE`.

---

## Event types

### PR lifecycle (ENTITY_TYPE = 'PR')

#### `PR_CREATED`
Emitted when a PR is inserted — either auto-created inside invoice POST, or manually.

```json
{
  "source": "auto-from-invoice" | "manual",
  "prNumber": "PR-2025-0123",
  "invoiceId": "INV-..."            // only when source = auto-from-invoice
}
```

#### `PR_UPDATED`
Whatever subset of PR fields the caller PUT. Mirrors the request body.

```json
{
  "status":   "ASSIGNED" | "IN_RFQ" | "AWARDED" | "CLOSED" | …,
  "priority": "low" | "normal" | "high",
  "assignedTo": "user@example.com",
  "notes":    "…"
}
```

#### `PR_CANCELLED`

```json
{ "reason": "Cancelled by procurement" }
```

---

### RFQ lifecycle (ENTITY_TYPE = 'RFQ')

#### `RFQ_CREATED`

```json
{
  "prIds":     ["PR-…", "PR-…"],
  "vendorIds": ["VEN-…", "VEN-…"],
  "rfqNumber": "RFQ-2025-0007"
}
```

#### `RFQ_SENT`
Per-vendor send result. Each result row contains `vendorId`, `vendorName`,
`sent` (boolean), and either `messageId` (success) or `error` (failure).

```json
{
  "sendResults": [
    { "vendorId": "VEN-…", "vendorName": "Acme",
      "sent": true,  "messageId": "<…@smtp>" },
    { "vendorId": "VEN-…", "vendorName": "Beta",
      "sent": false, "error": "No email on file" }
  ]
}
```

#### `RFQ_RESPONSE_LOGGED`
One row per logged response.

```json
{
  "vendorId": "VEN-…",
  "prId":     "PR-…",
  "unitCost": 123.45
}
```

#### `RFQ_RECOMMENDED` (officer → head hand-off)

```json
{
  "recommendedVendorId": "VEN-…",
  "responseIds":         [ "RSP-…" ],
  "score":               87.3,
  "reason":              "Lowest TCO with full coverage",
  "allowPartial":        false
}
```

#### `RFQ_CONTROLLER_APPROVED` (head approval — "controller" is legacy naming)

```json
{
  "totalAward": 12450.00,
  "pushbackResults": [
    { "sku": "ITM-001", "lineKey": "LINE-…", "unitCostOld": 0, "unitCostNew": 42.5, "rowsAffected": 1 }
  ]
}
```

#### `RFQ_CONTROLLER_REJECTED`

```json
{ "reason": "Prices too high" }
```

#### `RFQ_CANCELLED`

Always an empty object `{}` — the reason lives in a paired `QA_AUDIT_LOGS` row.

#### `RFQ_ESCALATED`
Fired both by the manual `/escalate` endpoint and by the `stalenessWatcher` cron.

```json
{
  "reason":       "Submission deadline missed by 3 days",
  "escalatedTo":  "proc-head@example.com",      // optional
  "trigger":      "manual" | "stalenessWatcher"
}
```

---

### Invoice lifecycle (ENTITY_TYPE = 'INVOICE')

#### `INVOICE_REAPPROVAL_REQUIRED`
Emitted by `/approve` (RFQ) when post-pushback variance crosses the threshold.

```json
{
  "originalEstimate": 10000,
  "newTotal":         12600,
  "variancePct":      26.0,
  "threshold":        10,
  "triggeredBy":      "RFQ-…"
}
```

#### `INVOICE_REAPPROVAL_DECISION`

```json
{
  "decision": "accept" | "bounce",
  "note":     "…"       // optional, actor's comment
}
```

---

### Vendor / setting (ENTITY_TYPE = 'VENDOR' | 'SETTING')

No routes currently emit into this table for these entity types; the
`CHK_PE_ENTITY` check constraint permits them for future use (e.g. vendor
blacklisting, procurement-threshold changes). Vendor edits are audited via
`QA_AUDIT_LOGS` with ACTION = `'Vendor Updated'` instead — see `vendors.js`.

---

## Conventions

- **Timestamps.** Always use `EVENT_TIME` (server-side default) — never re-encode
  client time into the payload.
- **Size.** Payload is truncated to ~3,900 chars before insert if large (see
  `auditLogs.js`). Don't emit full object dumps; keep payloads to IDs + deltas.
- **Idempotency.** Events are append-only. If an operation is retried, emit a
  second event — do not try to deduplicate at the insert site.
- **Reporting.**
  ```sql
  SELECT EVENT_TYPE, COUNT(*) FROM QA_PROCUREMENT_EVENTS
   WHERE ENTITY_TYPE = 'RFQ'
     AND EVENT_TIME >= SYSTIMESTAMP - INTERVAL '30' DAY
   GROUP BY EVENT_TYPE;
  ```
