'use strict';

/**
 * numberGenerator.js — atomic document-number minting.
 *
 * Standards anchor:
 *   - SAP "Number Range" semantics (gapless option deliberately NOT taken
 *     — we accept that rolled-back transactions leave numeric gaps; this
 *     is the same trade-off Oracle EBS makes by default. Forcing gapless
 *     would require a serialized lock on every transaction, which kills
 *     concurrent invoice creation at scale.)
 *   - Oracle row-level locking (SELECT ... FOR UPDATE) for safety under
 *     concurrent INSERT bursts. The lock is held only for the few
 *     microseconds between read and update — no risk of stuck locks.
 *
 * Usage from a route:
 *
 *   const { generateNumber } = require('../utils/numberGenerator');
 *   const newInvId = await generateNumber('INV');   // "MIDSA-INV-05-2026-00001"
 *
 * Configuration lives in QA_NUMBER_SEQUENCES (see migrate_number_sequences.js).
 * Admin / Finance Head edit the configuration via /api/number-sequences.
 *
 * Format produced:
 *   {PREFIX}-{DOC_CODE}-{PERIOD_KEY}-{COUNTER zero-padded}
 *
 *   Monthly: MIDSA-INV-05-2026-00001
 *   Yearly:  MIDSA-INV-2026-00001
 *   Never:   MIDSA-INV-00001
 */

const { transaction } = require('../db');

/**
 * Compute the period key for the current date based on the reset rule.
 *   MONTHLY → "MM-YYYY"  (e.g. "05-2026")
 *   YEARLY  → "YYYY"     (e.g. "2026")
 *   NEVER   → null       (no period segment in the ID)
 *
 * Centralised so the comparison in the generator matches the format
 * the ID assembler uses — single source of truth for "what month am I in."
 */
function computePeriodKey(resetPeriod, now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  if (resetPeriod === 'MONTHLY') return `${mm}-${yyyy}`;
  if (resetPeriod === 'YEARLY')  return String(yyyy);
  return null; // NEVER
}

/**
 * generateNumber(docType, opts) — returns the next document number atomically.
 *
 *   docType — 'INV' | 'PR' | 'RFQ' | 'GR' | 'MEMO' (or any custom row)
 *   opts.now — override "now" for testing (otherwise new Date())
 *
 * Throws if:
 *   - docType has no row in QA_NUMBER_SEQUENCES (config-missing — admin
 *     must run the migration or seed the row manually)
 *   - The DB is unreachable
 *
 * Concurrency:
 *   Uses SELECT ... FOR UPDATE inside the transaction wrapper, which
 *   takes a row-level lock until the UPDATE + COMMIT completes. Two
 *   simultaneous invoice creations will serialize on this lock — second
 *   waits ~few ms for the first to release. No duplicates, no gaps
 *   except from explicit rollbacks (which is the same behavior as Oracle
 *   sequences and matches industry expectation).
 */
async function generateNumber(docType, opts = {}) {
  if (!docType || typeof docType !== 'string') {
    throw new Error('generateNumber: docType is required (e.g. "INV", "PR")');
  }
  const code = docType.toUpperCase().trim();

  return await transaction(async (conn) => {
    // 1. Lock + read the current state
    const lockRes = await conn.execute(
      `SELECT PREFIX, DOC_CODE, PADDING, RESET_PERIOD,
              CURRENT_COUNTER, CURRENT_PERIOD_KEY
         FROM QA_NUMBER_SEQUENCES
        WHERE DOC_TYPE = :docType
          FOR UPDATE`,
      { docType: code },
      { outFormat: require('oracledb').OUT_FORMAT_OBJECT }
    );

    const row = (lockRes.rows || [])[0];
    if (!row) {
      throw new Error(
        `generateNumber: no row in QA_NUMBER_SEQUENCES for doc type "${code}". ` +
        `Run migrate_number_sequences.js to seed defaults, or have an admin ` +
        `add the row via /api/number-sequences.`
      );
    }

    // 2. Compute the period key for "now" using the configured reset rule
    const newPeriodKey = computePeriodKey(row.RESET_PERIOD, opts.now);

    // 3. Decide whether the counter rolls over (period changed) or
    //    increments (same period or NEVER-reset).
    let nextCounter;
    if (row.RESET_PERIOD === 'NEVER') {
      nextCounter = Number(row.CURRENT_COUNTER || 0) + 1;
    } else if (row.CURRENT_PERIOD_KEY === newPeriodKey) {
      // Still in the same period — just increment
      nextCounter = Number(row.CURRENT_COUNTER || 0) + 1;
    } else {
      // Period changed (or first ever generation) — reset to 1
      nextCounter = 1;
    }

    // 4. Persist
    await conn.execute(
      `UPDATE QA_NUMBER_SEQUENCES
          SET CURRENT_COUNTER    = :counter,
              CURRENT_PERIOD_KEY = :periodKey,
              UPDATED_AT         = SYSTIMESTAMP
        WHERE DOC_TYPE = :docType`,
      {
        counter:   nextCounter,
        periodKey: newPeriodKey,
        docType:   code
      }
    );

    // 5. Assemble the formatted ID
    const padded = String(nextCounter).padStart(Number(row.PADDING || 5), '0');
    const periodSegment = newPeriodKey ? `${newPeriodKey}-` : '';
    return `${row.PREFIX}-${row.DOC_CODE}-${periodSegment}${padded}`;
  });
}

/**
 * Preview the next number without consuming it. Used by the settings UI
 * to show "Next number will be: MIDSA-INV-05-2026-00124" so an admin can
 * see the effect of their config edits before saving.
 *
 * Does NOT take a lock and does NOT mutate the counter. Pure read.
 */
async function previewNextNumber(docType, opts = {}) {
  const { execute } = require('../db');
  const code = String(docType || '').toUpperCase().trim();
  const r = await execute(
    `SELECT PREFIX, DOC_CODE, PADDING, RESET_PERIOD,
            CURRENT_COUNTER, CURRENT_PERIOD_KEY
       FROM QA_NUMBER_SEQUENCES
      WHERE DOC_TYPE = :docType`,
    { docType: code }
  );
  const row = (r.rows || [])[0];
  if (!row) return null;

  const newPeriodKey = computePeriodKey(row.RESET_PERIOD, opts.now);
  let nextCounter;
  if (row.RESET_PERIOD === 'NEVER' || row.CURRENT_PERIOD_KEY === newPeriodKey) {
    nextCounter = Number(row.CURRENT_COUNTER || 0) + 1;
  } else {
    nextCounter = 1;
  }
  const padded = String(nextCounter).padStart(Number(row.PADDING || 5), '0');
  const periodSegment = newPeriodKey ? `${newPeriodKey}-` : '';
  return `${row.PREFIX}-${row.DOC_CODE}-${periodSegment}${padded}`;
}

module.exports = {
  generateNumber,
  previewNextNumber,
  computePeriodKey
};
