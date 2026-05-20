'use strict';

/**
 * notificationService — the single entry point the whole backend uses to
 * raise an in-app notification.
 *
 *   const { notify } = require('../services/notificationService');
 *
 *   notify({
 *     to:    { roles: ['finance_head'], excludeActor: true },
 *     actor: req.user.email,
 *     type:  'invoice.pending_approval',
 *     category: 'invoices',
 *     severity: 'warning',
 *     title: 'Invoice awaiting your approval',
 *     body:  `${id} for ${customerName} was submitted for approval.`,
 *     entityType: 'invoice', entityId: id,
 *     linkPage: 'invoiceEditor',
 *     linkContext: { invoiceId: id, returnTo: 'invoices' }
 *   });
 *
 * DESIGN
 * ──────
 *  - One row PER RECIPIENT in QA_NOTIFICATIONS, so read/archive state is
 *    per-user. `to` is a *target spec*, not a list of emails — the
 *    service resolves it against QA_USERS:
 *        { users: ['a@x.com'] }                  explicit
 *        { roles: ['finance_head','admin'] }      everyone with that tiered role
 *        { departments: ['procurement'] }         everyone in that department
 *        { excludeActor: true }                   never tell someone about their own action
 *    Legacy single-word roles in QA_USERS ('controller', 'sales', …) are
 *    mapped to their tiered equivalents so targeting stays correct during
 *    the role migration.
 *  - `groupKey` collapses duplicate UNREAD alerts: if the recipient
 *    already has an unread, un-archived notification with the same
 *    groupKey, we skip the insert. This stops the watcher job from
 *    re-spamming "stock low for SKU-123" on every pass.
 *  - Each inserted row is pushed live over Socket.io to that recipient's
 *    personal room (`user:<email>`), event `notification:new`.
 *  - notify() NEVER throws. A notification failure must not break the
 *    business transaction that triggered it — callers fire-and-forget.
 */

const oracledb = require('oracledb');
const { execute } = require('../db');
const { emitToAll } = require('../utils/socketEmitter');
const {
  ALL_ROLES,
  ROLE_DEPARTMENT,
  legacyRoleToTiered
} = require('../../shared/permissions');

/** Personal Socket.io room name for a user. */
function userRoom(email) {
  return `user:${String(email).toLowerCase()}`;
}

/** Map whatever is stored in QA_USERS.USER_ROLE to a canonical tiered role. */
function tieredRoleOf(rawRole) {
  if (!rawRole) return null;
  return ALL_ROLES.indexOf(rawRole) >= 0 ? rawRole : legacyRoleToTiered(rawRole);
}

/**
 * Resolve a target spec to a de-duplicated list of recipient emails.
 * Queries QA_USERS only when role/department targeting is requested.
 */
async function resolveRecipients(target = {}, actorEmail) {
  const set = new Set();

  if (Array.isArray(target.users)) {
    for (const u of target.users) {
      if (u) set.add(String(u).toLowerCase());
    }
  }

  const wantRoles = new Set(target.roles || []);
  const wantDepts = new Set(target.departments || []);
  if (wantRoles.size > 0 || wantDepts.size > 0) {
    const res = await execute(
      `SELECT USER_EMAIL, USER_ROLE FROM QA_USERS
        WHERE NVL(USER_STATUS, 'active') = 'active'`
    );
    for (const row of (res.rows || [])) {
      const tiered = tieredRoleOf(row.USER_ROLE);
      if (!tiered) continue;
      if (wantRoles.has(tiered)) {
        set.add(String(row.USER_EMAIL).toLowerCase());
        continue;
      }
      const dept = ROLE_DEPARTMENT[tiered];
      if (dept && wantDepts.has(dept)) {
        set.add(String(row.USER_EMAIL).toLowerCase());
      }
    }
  }

  // Never notify someone about their own action (unless explicitly opted out).
  if (target.excludeActor !== false && actorEmail) {
    set.delete(String(actorEmail).toLowerCase());
  }

  return [...set];
}

/** True if this recipient already has an unread, un-archived row with this groupKey. */
async function hasUnreadDuplicate(recipient, groupKey) {
  if (!groupKey) return false;
  const res = await execute(
    `SELECT 1 FROM QA_NOTIFICATIONS
      WHERE RECIPIENT = :r AND GROUP_KEY = :g AND IS_READ = 0 AND IS_ARCHIVED = 0
      FETCH FIRST 1 ROWS ONLY`,
    { r: recipient, g: groupKey }
  );
  return !!(res.rows && res.rows.length);
}

/**
 * Insert one notification row and return the full record (incl. its new id).
 */
async function insertNotification(recipient, n) {
  const res = await execute(
    `INSERT INTO QA_NOTIFICATIONS
       (RECIPIENT, TYPE, TITLE, BODY, SEVERITY, CATEGORY, ENTITY_TYPE, ENTITY_ID,
        LINK_PAGE, LINK_CONTEXT, ACTOR, GROUP_KEY)
     VALUES
       (:recipient, :type, :title, :body, :severity, :category, :etype, :eid,
        :lpage, :lctx, :actor, :gkey)
     RETURNING NOTIF_ID, TO_CHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') INTO :outId, :outTs`,
    {
      recipient,
      type:     n.type,
      title:    String(n.title || '').slice(0, 255),
      body:     n.body ? String(n.body).slice(0, 1000) : null,
      severity: n.severity || 'info',
      category: n.category || 'system',
      etype:    n.entityType || null,
      eid:      n.entityId ? String(n.entityId).slice(0, 120) : null,
      lpage:    n.linkPage || null,
      lctx:     n.linkContext ? JSON.stringify(n.linkContext).slice(0, 2000) : null,
      actor:    n.actor || null,
      gkey:     n.groupKey ? String(n.groupKey).slice(0, 160) : null,
      outId:    { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      outTs:    { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    }
  );

  const id = res.outBinds?.outId?.[0];
  const ts = res.outBinds?.outTs?.[0];

  return {
    id,
    recipient,
    type:        n.type,
    title:       n.title,
    body:        n.body || null,
    severity:    n.severity || 'info',
    category:    n.category || 'system',
    entityType:  n.entityType || null,
    entityId:    n.entityId || null,
    linkPage:    n.linkPage || null,
    linkContext: n.linkContext || null,
    actor:       n.actor || null,
    isRead:      false,
    isArchived:  false,
    createdAt:   ts || new Date().toISOString()
  };
}

/**
 * notify(spec) — raise a notification. Fire-and-forget; never throws.
 *
 * spec:
 *   to          { users?, roles?, departments?, excludeActor? }  (required)
 *   actor       email of the user who triggered the event
 *   type        machine key, e.g. 'invoice.approved'
 *   title       short headline (≤255 chars)
 *   body        one or two sentences (≤1000 chars)
 *   severity    'info' | 'success' | 'warning' | 'critical'
 *   category    'invoices' | 'procurement' | 'inventory' | 'finance' | 'system'
 *   entityType  / entityId   what the notification is about
 *   linkPage    / linkContext  AppContext deep-link target
 *   groupKey    de-dup key for unread alerts (optional)
 *
 * Returns the count of rows actually inserted (for tests / logging).
 */
async function notify(spec = {}) {
  try {
    if (!spec.type || !spec.title || !spec.to) {
      console.warn('[notify] missing type/title/to — skipped', spec.type);
      return 0;
    }

    const recipients = await resolveRecipients(spec.to, spec.actor);
    if (recipients.length === 0) return 0;

    let inserted = 0;
    for (const recipient of recipients) {
      try {
        if (await hasUnreadDuplicate(recipient, spec.groupKey)) continue;
        const record = await insertNotification(recipient, spec);
        inserted++;
        // Live push to just this user's room.
        emitToAll('notification:new', record, userRoom(recipient));
      } catch (rowErr) {
        console.error(`[notify] failed for ${recipient}:`, rowErr.message);
      }
    }
    return inserted;
  } catch (err) {
    // A notification failure must never break the caller's request.
    console.error('[notify] aborted:', err.message);
    return 0;
  }
}

module.exports = { notify, resolveRecipients, userRoom };
