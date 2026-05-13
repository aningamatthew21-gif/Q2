-- ===========================================================================
-- Authorization Phase A — Tiered Roles Migration
-- ===========================================================================
-- Brings the QA_USERS table in line with the new tiered authorization model
-- defined in shared/permissions.js. Two changes:
--
--   1. Widen USER_ROLE from VARCHAR2(20) to VARCHAR2(50) so the longest
--      tiered role strings (`procurement_officer` = 19 chars, `procurement_head`
--      = 16 chars, `system_admin` if ever used) fit comfortably.
--
--   2. Relax CHK_USERS_ROLE to accept the eight new tiered roles AND the
--      four legacy single-word roles (`sales`, `controller`, `procurement`,
--      `admin`). Day-one rollout keeps existing single-word roles working;
--      the auth middleware upgrades them to tiered roles at JWT decode time
--      via legacyRoleToTiered(). Individual users get promoted to tiered
--      roles via the helper UPDATE statements at the bottom of this file —
--      run those only after you've decided on the role for each person.
--
-- Idempotent: the constraint drop/recreate uses ORA-02443 / ORA-02264
-- ignore codes when run via migrate_procurement_schema.js. Running this
-- SQL directly via SQLPlus produces "constraint not found" / "constraint
-- name already used" warnings on second run — both safe.
--
-- To apply:
--   node backend/migrate_procurement_schema.js
--   (the migration step list at the top of that file includes this change)
--
-- Rollback:
--   schema_procurement_rollback.sql restores the four-role constraint.

-- 1. Widen USER_ROLE column
ALTER TABLE QA_USERS MODIFY (USER_ROLE VARCHAR2(50));

-- 2. Drop the existing constraint (whatever variant it is)
ALTER TABLE QA_USERS DROP CONSTRAINT CHK_USERS_ROLE;

-- 3. Recreate with the full set: 8 tiered + 4 legacy single-word roles
--    plus 'customer' for the portal.
ALTER TABLE QA_USERS ADD CONSTRAINT CHK_USERS_ROLE
  CHECK (USER_ROLE IN (
    -- Tiered roles (new authoritative model)
    'admin',
    'finance_officer',     'finance_head',
    'sales_officer',       'sales_head',
    'procurement_officer', 'procurement_head',
    'customer',

    -- Legacy roles (kept for day-one backward compat — auth middleware
    -- upgrades these to tiered roles at JWT-decode time).
    'sales',               'controller',
    'procurement'
  ));

-- ===========================================================================
-- Promotion helpers — run ONLY after deciding the right role per user.
-- These are commented out by default; uncomment and edit before running.
-- ===========================================================================

-- Example promotions (edit emails to match your real users):
--
-- -- The CEO / system owner stays admin.
-- UPDATE QA_USERS SET USER_ROLE = 'admin'                WHERE USER_EMAIL = 'ceo@midsa.com';
--
-- -- Finance side — existing 'controller' rows default-map to finance_head.
-- -- Explicitly promote the actual head and demote the rest to officer.
-- UPDATE QA_USERS SET USER_ROLE = 'finance_head'         WHERE USER_EMAIL = 'controller@midsa.com';
-- UPDATE QA_USERS SET USER_ROLE = 'finance_officer'      WHERE USER_EMAIL = 'accountant@midsa.com';
--
-- -- Sales side — existing 'sales' rows default-map to sales_officer.
-- -- Explicitly promote whoever should approve quotes pre-customer-send.
-- UPDATE QA_USERS SET USER_ROLE = 'sales_head'           WHERE USER_EMAIL = 'sales.manager@midsa.com';
--
-- -- Procurement side — existing 'procurement' rows default-map to procurement_head.
-- UPDATE QA_USERS SET USER_ROLE = 'procurement_head'     WHERE USER_EMAIL = 'procurement.lead@midsa.com';
-- UPDATE QA_USERS SET USER_ROLE = 'procurement_officer'  WHERE USER_EMAIL = 'buyer@midsa.com';

-- After promotions:
--   1. The user must log out and log back in (their JWT carries the old
--      role until it expires or is reissued).
--   2. Verify with:
--        SELECT USER_EMAIL, USER_ROLE FROM QA_USERS ORDER BY USER_ROLE;
