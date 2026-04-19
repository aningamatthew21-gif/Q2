-- ============================================================
-- PRICING UPGRADE SCHEMA
-- Adds item type, handling, transfer & admin columns to inventory
-- Adds pricing preset columns to QA_PRICING_SETTINGS
-- Adds procurement user
-- Run as QUOTEAPP user.
-- ============================================================

-- ==========================
-- 1. NEW COLUMNS ON QA_INVENTORY
-- ==========================
ALTER TABLE QA_INVENTORY ADD (
    ITEM_TYPE              VARCHAR2(20)   DEFAULT 'Hardware',
    HANDLING_PER_UNIT      NUMBER(15,4)   DEFAULT 0,
    TRANSFER_ADMIN_PER_UNIT NUMBER(15,4)  DEFAULT 0
);

ALTER TABLE QA_INVENTORY ADD CONSTRAINT CHK_INV_ITEM_TYPE
    CHECK (ITEM_TYPE IN ('Hardware', 'Software', 'Service'));

-- ==========================
-- 2. PRICING PRESET COLUMNS ON QA_PRICING_SETTINGS
-- ==========================
ALTER TABLE QA_PRICING_SETTINGS ADD (
    INSURANCE_RATE_PCT     NUMBER(10,6)   DEFAULT 0.01,
    FREIGHT_RATE_PCT       NUMBER(10,6)   DEFAULT 0.12,
    DUTY_RATE_PCT          NUMBER(10,6)   DEFAULT 0.50,
    HANDLING_RATE_PCT      NUMBER(10,6)   DEFAULT 0.02,
    TRANSFER_ADMIN_RATE_PCT NUMBER(10,6)  DEFAULT 0.015,
    DEFAULT_FX_RATE        NUMBER(15,6)   DEFAULT 13.05
);

-- Update existing row with preset defaults
UPDATE QA_PRICING_SETTINGS SET
    INSURANCE_RATE_PCT = 0.01,
    FREIGHT_RATE_PCT = 0.12,
    DUTY_RATE_PCT = 0.50,
    HANDLING_RATE_PCT = 0.02,
    TRANSFER_ADMIN_RATE_PCT = 0.015,
    DEFAULT_MARKUP_PCT = 30,
    DEFAULT_FX_RATE = 13.05
WHERE ID = 'pricing';

-- ==========================
-- 3. ADD PROCUREMENT USER
-- ==========================
INSERT INTO QA_USERS (USER_EMAIL, USER_ROLE, USER_NAME, USER_STATUS)
VALUES ('aningamatthew21+procure@gmail.com', 'procurement', 'Procurement User', 'active');

COMMIT;
