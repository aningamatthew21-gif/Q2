-- ============================================================================
-- Phase 5 — Risk & Escalation
-- Tracks staleness / past-deadline state and a one-shot escalation to the
-- procurement head when an RFQ stalls beyond the configured threshold.
--
-- Idempotent: uses PL/SQL + USER_TAB_COLUMNS existence checks. Safe to re-run.
-- Run as: QUOTEAPP user.
-- ============================================================================

DECLARE
    v_count NUMBER;

    PROCEDURE add_col_if_missing(p_col_name VARCHAR2, p_ddl VARCHAR2) IS
    BEGIN
        SELECT COUNT(*) INTO v_count FROM USER_TAB_COLUMNS
         WHERE TABLE_NAME = 'QA_RFQS' AND COLUMN_NAME = p_col_name;
        IF v_count = 0 THEN
            EXECUTE IMMEDIATE p_ddl;
        END IF;
    END;
BEGIN
    -- Last time the background watcher inspected this RFQ for staleness.
    -- Used to throttle escalation notifications and audit the watcher itself.
    add_col_if_missing('LAST_STALENESS_CHECK_AT', 'ALTER TABLE QA_RFQS ADD (LAST_STALENESS_CHECK_AT TIMESTAMP)');

    -- One-shot escalation audit. Populated the first time the watcher (or a
    -- manual /escalate call) raises an RFQ to the procurement head.
    add_col_if_missing('ESCALATED_AT',            'ALTER TABLE QA_RFQS ADD (ESCALATED_AT TIMESTAMP)');
    add_col_if_missing('ESCALATED_TO',            'ALTER TABLE QA_RFQS ADD (ESCALATED_TO VARCHAR2(255))');
    add_col_if_missing('ESCALATION_REASON',       'ALTER TABLE QA_RFQS ADD (ESCALATION_REASON VARCHAR2(500))');

    COMMIT;
END;
/

-- Seed configurable staleness escalation threshold (days since RFQ creation).
-- Best-practice default: 7 days.
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM QA_PROCUREMENT_SETTINGS
     WHERE SETTING_KEY = 'stalenessEscalationDays';
    IF v_exists = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL)
        VALUES ('stalenessEscalationDays', '7');
    END IF;

    -- Email of the procurement head who receives escalations. Empty by default;
    -- the UI will show a warning until it's populated.
    SELECT COUNT(*) INTO v_exists FROM QA_PROCUREMENT_SETTINGS
     WHERE SETTING_KEY = 'procurementHeadEmail';
    IF v_exists = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL)
        VALUES ('procurementHeadEmail', '');
    END IF;

    COMMIT;
END;
/

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
  FROM USER_TAB_COLUMNS
 WHERE TABLE_NAME = 'QA_RFQS'
   AND COLUMN_NAME IN ('LAST_STALENESS_CHECK_AT','ESCALATED_AT','ESCALATED_TO','ESCALATION_REASON')
 ORDER BY COLUMN_NAME;

SELECT SETTING_KEY, SETTING_VAL
  FROM QA_PROCUREMENT_SETTINGS
 WHERE SETTING_KEY IN ('stalenessEscalationDays','procurementHeadEmail');
