'use strict';

/**
 * notificationWatcher — periodic background job for STATE-BASED alerts:
 * things no single click triggers, that only a sweep can notice.
 *
 *   1. Low stock        — inventory items at/below their restock limit.
 *   2. Expiring quotes  — quotes whose expiry date is within 3 days.
 *   3. Approval SLA     — invoices stuck in "Pending Approval" > 24h.
 *
 * Every alert carries a stable `groupKey`, so notify()'s unread-dedup
 * means a re-run never re-spams the same person about the same thing
 * until they've actioned (read) the previous one. The first run after a
 * deploy is capped per category so a big backlog drains gradually
 * instead of dumping hundreds of rows at once.
 *
 * Mirrors the stalenessWatcher pattern:
 *   startNotificationWatcher(options?) — begins the timer.
 *   runNotificationCheckOnce()         — single pass, returns a summary.
 */

const { execute } = require('../db');
const { notify } = require('../services/notificationService');

// Per-run caps so the very first sweep can't dump a huge backlog at once.
const MAX_LOW_STOCK   = 25;
const MAX_EXPIRING    = 25;
const MAX_SLA         = 25;

// Thresholds
const QUOTE_EXPIRY_WARN_DAYS = 3;
const APPROVAL_SLA_HOURS     = 24;

/** Low-stock inventory → procurement desk + finance head. */
async function checkLowStock() {
  const res = await execute(
    `SELECT SKU, ITEM_NAME, STOCK, RESTOCK_LIMIT
       FROM QA_INVENTORY
      WHERE RESTOCK_LIMIT > 0 AND STOCK <= RESTOCK_LIMIT
      ORDER BY (STOCK - RESTOCK_LIMIT) ASC
      FETCH FIRST :lim ROWS ONLY`,
    { lim: MAX_LOW_STOCK }
  );
  const rows = res.rows || [];
  for (const r of rows) {
    const out = Number(r.STOCK) <= 0;
    await notify({
      to: { departments: ['procurement'], roles: ['finance_head'] },
      type: out ? 'inventory.out_of_stock' : 'inventory.low_stock',
      category: 'inventory',
      severity: out ? 'critical' : 'warning',
      title: out ? `Out of stock: ${r.ITEM_NAME}` : `Low stock: ${r.ITEM_NAME}`,
      body: out
        ? `${r.ITEM_NAME} (${r.SKU}) is out of stock. Restock level is ${r.RESTOCK_LIMIT}.`
        : `${r.ITEM_NAME} (${r.SKU}) is down to ${r.STOCK} — at or below its restock level of ${r.RESTOCK_LIMIT}.`,
      entityType: 'inventory', entityId: r.SKU,
      linkPage: 'inventory', linkContext: {},
      groupKey: `lowstock:${r.SKU}`
    });
  }
  return rows.length;
}

/** Quotes nearing expiry → the salesperson who owns them. */
async function checkExpiringQuotes() {
  // EXPIRES_AT is a free-text VARCHAR column — fetch candidates and parse
  // defensively in JS rather than trusting a SQL date comparison.
  const res = await execute(
    `SELECT QUOTE_ID, CUSTOMER_NAME, EXPIRES_AT, CREATED_BY
       FROM QA_QUOTES
      WHERE CONVERTED_TO_INV IS NULL
        AND EXPIRES_AT IS NOT NULL
        AND NVL(STATUS,'DRAFT') NOT IN ('EXPIRED','CONVERTED','CANCELLED')`
  );
  const now = Date.now();
  const horizon = QUOTE_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000;
  let sent = 0;
  for (const r of (res.rows || [])) {
    if (sent >= MAX_EXPIRING) break;
    const t = Date.parse(r.EXPIRES_AT);
    if (Number.isNaN(t)) continue;            // unparseable — skip quietly
    const ms = t - now;
    if (ms < 0 || ms > horizon) continue;     // already expired, or not close yet
    if (!r.CREATED_BY) continue;
    const days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    await notify({
      to: { users: [r.CREATED_BY] },
      type: 'quote.expiring', category: 'invoices', severity: 'warning',
      title: 'Quote expiring soon',
      body: `Quote ${r.QUOTE_ID} for ${r.CUSTOMER_NAME || 'a customer'} expires in ${days} day${days === 1 ? '' : 's'}.`,
      entityType: 'quote', entityId: r.QUOTE_ID,
      linkPage: 'quoting', linkContext: { quoteId: r.QUOTE_ID },
      groupKey: `quote_expiring:${r.QUOTE_ID}`
    });
    sent++;
  }
  return sent;
}

/** Invoices stuck awaiting finance approval beyond the SLA → finance heads. */
async function checkApprovalSLA() {
  const res = await execute(
    `SELECT INVOICE_ID, CUSTOMER_NAME, TOTAL, CURRENCY, SUBMITTED_AT
       FROM QA_INVOICES
      WHERE STATUS = 'Pending Approval'
        AND SUBMITTED_AT IS NOT NULL
        AND SUBMITTED_AT < (SYSTIMESTAMP - INTERVAL '${APPROVAL_SLA_HOURS}' HOUR)
      ORDER BY SUBMITTED_AT ASC
      FETCH FIRST :lim ROWS ONLY`,
    { lim: MAX_SLA }
  );
  const rows = res.rows || [];
  for (const r of rows) {
    await notify({
      to: { roles: ['finance_head'] },
      type: 'invoice.approval_overdue', category: 'finance', severity: 'warning',
      title: 'Invoice approval overdue',
      body: `${r.INVOICE_ID} for ${r.CUSTOMER_NAME || 'a customer'} has been awaiting approval for over ${APPROVAL_SLA_HOURS} hours.`,
      entityType: 'invoice', entityId: r.INVOICE_ID,
      linkPage: 'invoiceEditor', linkContext: { invoiceId: r.INVOICE_ID, returnTo: 'invoices' },
      groupKey: `sla:${r.INVOICE_ID}`
    });
  }
  return rows.length;
}

/** One full pass. Safe to call from a manual trigger or the timer. */
async function runNotificationCheckOnce() {
  const summary = { lowStock: 0, expiringQuotes: 0, slaBreaches: 0 };
  try { summary.lowStock       = await checkLowStock(); }       catch (e) { console.error('[notificationWatcher] lowStock:', e.message); }
  try { summary.expiringQuotes = await checkExpiringQuotes(); } catch (e) { console.error('[notificationWatcher] expiringQuotes:', e.message); }
  try { summary.slaBreaches    = await checkApprovalSLA(); }    catch (e) { console.error('[notificationWatcher] approvalSLA:', e.message); }

  const total = summary.lowStock + summary.expiringQuotes + summary.slaBreaches;
  if (total > 0) {
    console.log('[notificationWatcher] pass complete:', summary);
  }
  return summary;
}

/**
 * Starts a recurring timer. Default interval: 15 minutes.
 * Returns the handle so a graceful shutdown can clear it.
 */
function startNotificationWatcher({ intervalMs = 15 * 60 * 1000, runOnStart = true } = {}) {
  const run = async () => {
    try {
      await runNotificationCheckOnce();
    } catch (err) {
      console.error('[notificationWatcher] pass failed:', err.message);
    }
  };

  if (runOnStart) {
    // Delay the first run so it doesn't race with pool init.
    setTimeout(run, 8000);
  }

  const handle = setInterval(run, intervalMs);
  console.log(`⏰ Notification watcher active — interval ${Math.round(intervalMs / 60000)}min`);
  return handle;
}

module.exports = {
  startNotificationWatcher,
  runNotificationCheckOnce
};
