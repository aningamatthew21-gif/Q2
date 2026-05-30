'use strict';

/**
 * Permission catalogue invariants — the safety net for the work done in
 * Pass 1 and Pass 2. These are pure unit tests with no DB / network /
 * Express dependencies, so they run in milliseconds.
 *
 *   node --test backend/__tests__/
 *
 * No new packages — uses Node 22's built-in `node:test` runner.
 *
 * What we're protecting:
 *   1. Every action key referenced in ROLE_ACTIONS, PAGE_PERMISSIONS and
 *      SOD_RULES must exist in the ACTIONS catalogue. Typos in any of
 *      those grant tables would silently grant nothing (a "shadow gate").
 *   2. `can()` must say YES for grants the catalogue lists, NO otherwise.
 *      Admin is the only role with universal access.
 *   3. The four SoD rules must reject the actor when they're the creator
 *      of the entity. This is the core "approver != creator" invariant.
 *   4. legacyRoleToTiered must map every legacy role to a valid tiered
 *      role — the migration helper.
 *   5. Officer tiers must hold their working-set actions (regression
 *      guard against the Pass 1/2 fix where officers were silently
 *      locked out of their own jobs).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  ROLES,
  ALL_ROLES,
  ACTIONS,
  ALL_ACTIONS,
  ROLE_ACTIONS,
  PAGE_PERMISSIONS,
  SOD_RULES,
  ROLE_DEPARTMENT,
  legacyRoleToTiered,
  can,
  canOpenPage,
  actionsFor
} = require('../../shared/permissions');

// ────────────────────────────────────────────────────────────────────────
test('catalogue: every role in ROLES is a non-empty string', () => {
  for (const r of ALL_ROLES) {
    assert.ok(r && typeof r === 'string', `bad role value: ${r}`);
  }
});

test('catalogue: ROLE_ACTIONS contains exactly the roles in ROLES (no orphans, no gaps)', () => {
  const roleKeys = Object.keys(ROLE_ACTIONS).sort();
  const want = [...ALL_ROLES].sort();
  assert.deepStrictEqual(roleKeys, want);
});

test('catalogue: every action granted in ROLE_ACTIONS exists in ACTIONS', () => {
  for (const [role, grants] of Object.entries(ROLE_ACTIONS)) {
    for (const action of grants) {
      assert.ok(
        ALL_ACTIONS.includes(action),
        `Role ${role} is granted unknown action '${action}'`
      );
    }
  }
});

test('catalogue: every permission referenced in PAGE_PERMISSIONS exists in ACTIONS (or is null/public)', () => {
  for (const [page, perm] of Object.entries(PAGE_PERMISSIONS)) {
    if (perm === null || perm === undefined) continue;
    assert.ok(
      ALL_ACTIONS.includes(perm),
      `Page '${page}' requires unknown action '${perm}'`
    );
  }
});

test('catalogue: every SOD_RULES key exists in ACTIONS', () => {
  for (const key of Object.keys(SOD_RULES)) {
    assert.ok(
      ALL_ACTIONS.includes(key),
      `SoD rule '${key}' is not an ACTIONS key`
    );
  }
});

test('catalogue: every tiered role has a department mapping', () => {
  for (const r of ALL_ROLES) {
    assert.ok(ROLE_DEPARTMENT[r], `Role ${r} has no department mapping`);
  }
});

// ────────────────────────────────────────────────────────────────────────
test('can(): admin can do everything', () => {
  for (const action of ALL_ACTIONS) {
    assert.strictEqual(can(ROLES.ADMIN, action), true, `admin denied ${action}`);
  }
});

test('can(): missing role / missing action returns false', () => {
  assert.strictEqual(can(null,          'invoice.read.own'), false);
  assert.strictEqual(can(ROLES.ADMIN,   null),                false);
  assert.strictEqual(can('not-a-role',  'invoice.read.own'), false);
});

test('can(): sales_officer has invoice.read.own but not invoice.read.all', () => {
  assert.strictEqual(can(ROLES.SALES_OFFICER, 'invoice.read.own'), true);
  assert.strictEqual(can(ROLES.SALES_OFFICER, 'invoice.read.all'), false);
});

test('can(): finance_head has invoice.approve.finance, sales_head does not', () => {
  assert.strictEqual(can(ROLES.FINANCE_HEAD, 'invoice.approve.finance'), true);
  assert.strictEqual(can(ROLES.SALES_HEAD,   'invoice.approve.finance'), false);
});

test('can(): procurement_officer keeps their working-set actions (Pass 1/2 regression guard)', () => {
  // These are the actions that were silently locked out by the legacy
  // `requireRole('procurement','controller','admin')` pattern. If the
  // catalogue ever drops one of these grants, the officer goes back to
  // being unable to do their job.
  const workingSet = [
    'pr.create', 'pr.cancel', 'pr.fulfill',
    'rfq.create', 'rfq.send', 'rfq.response.log', 'rfq.recommend',
    'rfq.escalate',
    'vendor.write',
    'procurement.settings.read'
  ];
  for (const action of workingSet) {
    assert.strictEqual(
      can(ROLES.PROCUREMENT_OFFICER, action), true,
      `procurement_officer must keep '${action}'`
    );
  }
});

test('can(): procurement_officer must NOT have head-only actions', () => {
  const headOnly = [
    'rfq.approve.award', 'rfq.reject', 'rfq.cancel',
    'vendor.deactivate',
    'procurement.settings.edit'
  ];
  for (const action of headOnly) {
    assert.strictEqual(
      can(ROLES.PROCUREMENT_OFFICER, action), false,
      `procurement_officer must NOT have '${action}' (head-only)`
    );
  }
});

test('can(): sales_officer cannot approve invoices', () => {
  assert.strictEqual(can(ROLES.SALES_OFFICER, 'invoice.approve.sales'),   false);
  assert.strictEqual(can(ROLES.SALES_OFFICER, 'invoice.approve.finance'), false);
});

test('can(): customer role has only portal permissions', () => {
  assert.strictEqual(can(ROLES.CUSTOMER, 'portal.read.own'),   true);
  assert.strictEqual(can(ROLES.CUSTOMER, 'portal.accept'),     true);
  assert.strictEqual(can(ROLES.CUSTOMER, 'invoice.read.own'),  false);
  assert.strictEqual(can(ROLES.CUSTOMER, 'inventory.read'),    false);
  assert.strictEqual(can(ROLES.CUSTOMER, 'customer.read'),     false);
});

// ────────────────────────────────────────────────────────────────────────
test('SoD invoice.approve.sales: approver must NOT be creator or salesperson', () => {
  const rule = SOD_RULES['invoice.approve.sales'];
  const invoice = { createdBy: 'alice@x.com', salesPersonId: 'bob@x.com' };
  assert.strictEqual(rule.check({ email: 'alice@x.com' }, invoice), false, 'creator must not approve');
  assert.strictEqual(rule.check({ email: 'bob@x.com'   }, invoice), false, 'salesperson must not approve');
  assert.strictEqual(rule.check({ email: 'eve@x.com'   }, invoice), true,  'third party may approve');
});

test('SoD invoice.approve.finance: approver must NOT be creator or salesperson', () => {
  const rule = SOD_RULES['invoice.approve.finance'];
  const invoice = { createdBy: 'alice@x.com', salesPersonId: 'bob@x.com' };
  assert.strictEqual(rule.check({ email: 'alice@x.com' }, invoice), false);
  assert.strictEqual(rule.check({ email: 'eve@x.com'   }, invoice), true);
});

test('SoD rfq.approve.award: approver must NOT be the officer who recommended (unless role bypass)', () => {
  const rule = SOD_RULES['rfq.approve.award'];
  const rfq = { recommendedBy: 'alice@x.com' };
  // Same actor with officer role: SoD denies (the core invariant)
  assert.strictEqual(rule.check({ email: 'alice@x.com', role: 'procurement_officer' }, rfq), false);
  // Third party with officer role: allowed
  assert.strictEqual(rule.check({ email: 'eve@x.com',   role: 'procurement_officer' }, rfq), true);
  // Role-based bypass (ISO 27001 A.5.3 — audit log compensates):
  //   admin, procurement_head (domain authority), finance_head (cross-dept) all bypass.
  assert.strictEqual(rule.check({ email: 'alice@x.com', role: 'admin' },             rfq), true,  'admin self-award allowed (role bypass)');
  assert.strictEqual(rule.check({ email: 'alice@x.com', role: 'procurement_head' },  rfq), true,  'procurement_head self-award allowed (domain authority)');
  assert.strictEqual(rule.check({ email: 'alice@x.com', role: 'finance_head' },      rfq), true,  'finance_head self-award allowed (parity with other 3 SoDs)');
});

test('SoD: admin role bypasses every SoD rule (defensive regression — closes "no admin restrictions" requirement)', () => {
  // If a future contributor accidentally drops the admin bypass on any
  // SoD rule, this test catches it. The bypass is a documented design
  // choice under ISO 27001 A.5.3 with the audit log as compensating control.
  const adminSelf = { email: 'alice@x.com', role: 'admin' };
  assert.strictEqual(SOD_RULES['invoice.approve.sales'].check(adminSelf, { createdBy: 'alice@x.com', salesPersonId: 'alice@x.com' }), true, 'admin bypasses invoice.approve.sales');
  assert.strictEqual(SOD_RULES['invoice.approve.finance'].check(adminSelf, { createdBy: 'alice@x.com', salesPersonId: 'alice@x.com' }), true, 'admin bypasses invoice.approve.finance');
  assert.strictEqual(SOD_RULES['rfq.approve.award'].check(adminSelf, { recommendedBy: 'alice@x.com' }), true, 'admin bypasses rfq.approve.award');
  assert.strictEqual(SOD_RULES['invoice.customer_action'].check(adminSelf, { sentBy: 'alice@x.com' }), true, 'admin bypasses invoice.customer_action');
});

test('can(): sales_head has invoice.read.all (broad ERP read for sales pipeline)', () => {
  // After the ERP-style read relaxation, sales_head holds broad read so
  // the AllInvoices page nav entry (PAGE_PERMISSIONS.invoices = invoice.read.all)
  // appears for them. Replaces the legacy dead-code invoice.read.team grant.
  assert.strictEqual(can(ROLES.SALES_HEAD, 'invoice.read.all'), true);
});

test('can(): sales_officer does NOT have invoice.read.all (page gate stays at .own)', () => {
  // The backend list endpoint returns all invoices to any authenticated
  // internal user (broad-read ERP pattern), but the AllInvoices PAGE
  // is still gated at .read.all so sales_officer's nav surface stays
  // scoped to MyInvoices. Future contributor who grants .read.all to
  // sales_officer would silently widen the page-permission surface;
  // this test makes that change visible.
  assert.strictEqual(can(ROLES.SALES_OFFICER, 'invoice.read.all'), false);
});

test('SoD invoice.customer_action: actor must NOT be the user who sent the invoice', () => {
  const rule = SOD_RULES['invoice.customer_action'];
  const invoice = { sentBy: 'alice@x.com' };
  assert.strictEqual(rule.check({ email: 'alice@x.com' }, invoice), false);
  assert.strictEqual(rule.check({ email: 'eve@x.com'   }, invoice), true);
});

test('Error Monitor: system.errors.read is admin-only (no other role)', () => {
  // EH-4 Error Monitor page is gated by `system.errors.read`. Only admin
  // should hold it on day one; if a future contributor accidentally grants
  // it to another role (e.g. finance_head), this test catches the
  // surface widening — admin override on observability is intentional;
  // delegation to support tier is a deliberate decision, not a drift.
  assert.strictEqual(can(ROLES.ADMIN,               'system.errors.read'), true);
  assert.strictEqual(can(ROLES.FINANCE_HEAD,        'system.errors.read'), false);
  assert.strictEqual(can(ROLES.FINANCE_OFFICER,     'system.errors.read'), false);
  assert.strictEqual(can(ROLES.SALES_HEAD,          'system.errors.read'), false);
  assert.strictEqual(can(ROLES.SALES_OFFICER,       'system.errors.read'), false);
  assert.strictEqual(can(ROLES.PROCUREMENT_HEAD,    'system.errors.read'), false);
  assert.strictEqual(can(ROLES.PROCUREMENT_OFFICER, 'system.errors.read'), false);
  assert.strictEqual(can(ROLES.CUSTOMER,            'system.errors.read'), false);
});

test('SoD: missing user or entity returns false (deny by default)', () => {
  for (const rule of Object.values(SOD_RULES)) {
    assert.strictEqual(rule.check(null,                 { createdBy: 'a' }), false);
    assert.strictEqual(rule.check({ email: 'a@x.com' }, null),                false);
    assert.strictEqual(rule.check({},                    {}),                  false);
  }
});

// ────────────────────────────────────────────────────────────────────────
test('legacyRoleToTiered: every known legacy role maps to a valid tiered role', () => {
  const cases = [
    ['admin',        ROLES.ADMIN],
    ['controller',   ROLES.FINANCE_HEAD],
    ['procurement',  ROLES.PROCUREMENT_HEAD],
    ['sales',        ROLES.SALES_OFFICER],
    ['customer',     ROLES.CUSTOMER]
  ];
  for (const [legacy, expected] of cases) {
    assert.strictEqual(legacyRoleToTiered(legacy), expected, `legacy '${legacy}'`);
    assert.ok(ALL_ROLES.includes(legacyRoleToTiered(legacy)), `'${legacy}' mapped to invalid role`);
  }
});

test('legacyRoleToTiered: unknown role defaults to sales_officer (least-privilege)', () => {
  assert.strictEqual(legacyRoleToTiered('something-weird'), ROLES.SALES_OFFICER);
  assert.strictEqual(legacyRoleToTiered(null),               ROLES.SALES_OFFICER);
});

// ────────────────────────────────────────────────────────────────────────
test('canOpenPage: null page permission = public', () => {
  // login is null in the catalogue — every role should be allowed.
  for (const r of ALL_ROLES) {
    assert.strictEqual(canOpenPage(r, 'login'), true, `role ${r} blocked from login`);
  }
});

test('canOpenPage: user management is admin-only', () => {
  for (const r of ALL_ROLES) {
    const allowed = canOpenPage(r, 'userManagement');
    assert.strictEqual(allowed, r === ROLES.ADMIN, `role ${r} ${allowed ? 'CAN' : 'cannot'} open userManagement`);
  }
});

test('actionsFor: returns empty array for unknown role (no crash)', () => {
  assert.deepStrictEqual(actionsFor('not-a-role'), []);
});

// ────────────────────────────────────────────────────────────────────────
// Sanity counts — alerts if the catalogue accidentally shrinks.
test('counts: at least 50 actions, 8 roles, 4 SoD rules', () => {
  assert.ok(ALL_ACTIONS.length >= 50, `only ${ALL_ACTIONS.length} actions`);
  assert.ok(ALL_ROLES.length    >= 8, `only ${ALL_ROLES.length} roles`);
  assert.ok(Object.keys(SOD_RULES).length >= 4, 'fewer than 4 SoD rules');
});
