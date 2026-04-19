-- ============================================================================
-- Phase 4 — Quote Re-Approval Loop
-- When an RFQ is approved and cost pushback materially changes the invoice
-- total (beyond configurable variance threshold), the invoice is flagged
-- REQUIRES_REAPPROVAL so the controller (and sales) can re-confirm the quote
-- before it reaches the customer.
--
-- Idempotent: uses PL/SQL + USER_TAB_COLUMNS existence checks. Safe to re-run.
-- Run as: QUOTEAPP user.
-- ============================================================================

DECLARE
    v_count NUMBER;

    PROCEDURE add_col_if_missing(p_col_name VARCHAR2, p_ddl VARCHAR2) IS
    BEGIN
        SELECT COUNT(*) INTO v_count FROM USER_TAB_COLUMNS
         WHERE TABLE_NAME = 'QA_INVOICES' AND COLUMN_NAME = p_col_name;
        IF v_count = 0 THEN
            EXECUTE IMMEDIATE p_ddl;
        END IF;
    END;
BEGIN
    -- Snapshot of the invoice total BEFORE sourcing/pushback touched it.
    -- Captured at invoice creation when requiresProcurement = true.
    add_col_if_missing('ORIGINAL_ESTIMATE',      'ALTER TABLE QA_INVOICES ADD (ORIGINAL_ESTIMATE NUMBER(18,4))');

    -- Flag set on /approve when |newTotal - originalEstimate|/originalEstimate > threshold.
    add_col_if_missing('REQUIRES_REAPPROVAL',    'ALTER TABLE QA_INVOICES ADD (REQUIRES_REAPPROVAL NUMBER(1) DEFAULT 0)');

    -- Variance metadata captured at the moment the flag was raised (for auditing / UI display).
    add_col_if_missing('REAPPROVAL_VARIANCE',    'ALTER TABLE QA_INVOICES ADD (REAPPROVAL_VARIANCE NUMBER(10,4))');
    add_col_if_missing('REAPPROVAL_REASON',      'ALTER TABLE QA_INVOICES ADD (REAPPROVAL_REASON VARCHAR2(500))');

    -- Audit of who cleared the flag and when.
    add_col_if_missing('REAPPROVED_BY',          'ALTER TABLE QA_INVOICES ADD (REAPPROVED_BY VARCHAR2(255))');
    add_col_if_missing('REAPPROVED_AT',          'ALTER TABLE QA_INVOICES ADD (REAPPROVED_AT TIMESTAMP)');

    COMMIT;
END;
/

-- Seed variance threshold setting (best-practice default: 10%).
-- Value is a whole-percent integer, so 10 means "flag when variance exceeds 10%".
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM QA_PROCUREMENT_SETTINGS
     WHERE SETTING_KEY = 'reapprovalVarianceThreshold';
    IF v_exists = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL)
        VALUES ('reapprovalVarianceThreshold', '10');
    END IF;
    COMMIT;
END;
/

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
  FROM USER_TAB_COLUMNS
 WHERE TABLE_NAME = 'QA_INVOICES'
   AND COLUMN_NAME IN ('ORIGINAL_ESTIMATE','REQUIRES_REAPPROVAL','REAPPROVAL_VARIANCE',
                       'REAPPROVAL_REASON','REAPPROVED_BY','REAPPROVED_AT')
 ORDER BY COLUMN_NAME;

SELECT SETTING_KEY, SETTING_VAL
  FROM QA_PROCUREMENT_SETTINGS
 WHERE SETTING_KEY = 'reapprovalVarianceThreshold';
