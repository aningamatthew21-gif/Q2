'use strict';

/**
 * Phase 5 — Staleness Watcher
 *
 * Periodic background job that inspects active RFQs and:
 *
 *   1. Records LAST_STALENESS_CHECK_AT = NOW on every active RFQ (for audit).
 *   2. If an RFQ has been open (CREATED_AT → NOW) for more than the configured
 *      `stalenessEscalationDays` threshold AND has not already been escalated,
 *      stamps ESCALATED_AT / ESCALATED_TO / ESCALATION_REASON and writes an
 *      RFQ_ESCALATED procurement event. Socket-broadcasts `rfq:updated`.
 *
 * Runs every STALENESS_CHECK_INTERVAL_MS (default 1 hour). The job is safe to
 * run frequently — escalation is one-shot per RFQ.
 *
 * Exports:
 *   startStalenessWatcher(options?) — begins the timer.
 *   runStalenessCheckOnce()         — single pass, returns escalations[].
 */

const { execute, transaction } = require('../db');
const { emitToAll } = require('../utils/socketEmitter');

// Active statuses that are eligible for escalation. AWARDED / CANCELLED /
// DRAFT are excluded — they are either done or not yet in flight.
const ACTIVE_STATUSES = ['SENT', 'RECEIVING', 'COMPARING'];

async function loadSettings() {
  const res = await execute(
    `SELECT SETTING_KEY, SETTING_VAL FROM QA_PROCUREMENT_SETTINGS
      WHERE SETTING_KEY IN ('stalenessEscalationDays','procurementHeadEmail')`
  );
  const settings = { stalenessEscalationDays: 7, procurementHeadEmail: '' };
  for (const row of (res.rows || [])) {
    if (row.SETTING_KEY === 'stalenessEscalationDays') {
      settings.stalenessEscalationDays = Number(row.SETTING_VAL) || 7;
    } else if (row.SETTING_KEY === 'procurementHeadEmail') {
      settings.procurementHeadEmail = row.SETTING_VAL || '';
    }
  }
  return settings;
}

/**
 * Single pass over all active RFQs. Safe to invoke from a manual trigger or
 * the periodic timer.
 */
async function runStalenessCheckOnce() {
  const settings = await loadSettings();
  const thresholdDays = settings.stalenessEscalationDays;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const headEmail = settings.procurementHeadEmail || null;

  const res = await execute(
    `SELECT RFQ_ID, RFQ_NUMBER, STATUS, CREATED_AT, SUBMISSION_DEADLINE,
            ESCALATED_AT, CREATED_BY
       FROM QA_RFQS
      WHERE STATUS IN ('SENT','RECEIVING','COMPARING')`
  );

  const now = new Date();
  const escalations = [];

  await transaction(async (conn) => {
    for (const row of (res.rows || [])) {
      const createdAt = row.CREATED_AT ? new Date(row.CREATED_AT) : null;
      const ageMs = createdAt ? (now.getTime() - createdAt.getTime()) : 0;
      const alreadyEscalated = !!row.ESCALATED_AT;
      const shouldEscalate = !alreadyEscalated && createdAt && ageMs > thresholdMs;

      // Always stamp the check timestamp so operators can see the watcher
      // is running — even when no escalation is raised.
      if (shouldEscalate) {
        const reason =
          `RFQ has been in ${row.STATUS} state for ${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days ` +
          `(threshold ${thresholdDays}). Automatic escalation to procurement head.`;

        await conn.execute(
          `UPDATE QA_RFQS
              SET LAST_STALENESS_CHECK_AT = SYSTIMESTAMP,
                  ESCALATED_AT            = SYSTIMESTAMP,
                  ESCALATED_TO            = :to,
                  ESCALATION_REASON       = :rsn,
                  UPDATED_AT              = SYSTIMESTAMP
            WHERE RFQ_ID = :id`,
          { to: headEmail, rsn: reason, id: row.RFQ_ID }
        );

        await conn.execute(
          `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
           VALUES ('RFQ_ESCALATED','RFQ',:id,'stalenessWatcher',:payload)`,
          {
            id: row.RFQ_ID,
            payload: JSON.stringify({
              rfqNumber: row.RFQ_NUMBER,
              status: row.STATUS,
              createdAt: row.CREATED_AT,
              ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
              thresholdDays,
              escalatedTo: headEmail,
              createdBy: row.CREATED_BY
            })
          }
        );

        escalations.push({
          rfqId: row.RFQ_ID,
          rfqNumber: row.RFQ_NUMBER,
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          escalatedTo: headEmail
        });
      } else {
        await conn.execute(
          `UPDATE QA_RFQS
              SET LAST_STALENESS_CHECK_AT = SYSTIMESTAMP
            WHERE RFQ_ID = :id`,
          { id: row.RFQ_ID }
        );
      }
    }
  });

  if (escalations.length > 0) {
    emitToAll('rfq:updated');
    console.log(`[stalenessWatcher] Escalated ${escalations.length} RFQ(s):`, escalations);
  }

  return { escalations, inspected: (res.rows || []).length, thresholdDays };
}

/**
 * Starts a recurring timer. Default interval: 1 hour.
 * Returns the handle so a graceful shutdown can clear it.
 */
function startStalenessWatcher({ intervalMs = 60 * 60 * 1000, runOnStart = true } = {}) {
  const run = async () => {
    try {
      await runStalenessCheckOnce();
    } catch (err) {
      console.error('[stalenessWatcher] pass failed:', err.message);
    }
  };

  if (runOnStart) {
    // Delay the first run a few seconds so it doesn't race with pool init
    setTimeout(run, 5000);
  }

  const handle = setInterval(run, intervalMs);
  console.log(`⏰ Staleness watcher active — interval ${Math.round(intervalMs / 60000)}min`);
  return handle;
}

module.exports = {
  startStalenessWatcher,
  runStalenessCheckOnce,
  ACTIVE_STATUSES
};
