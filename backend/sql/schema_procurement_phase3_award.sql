-- ============================================================================
-- Phase 3 — Award Workflow Polish
-- Adds recommendation metadata + approver audit + partial-award toggle to QA_RFQS.
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
    add_col_if_missing('RECOMMENDED_VENDOR_ID',   'ALTER TABLE QA_RFQS ADD (RECOMMENDED_VENDOR_ID VARCHAR2(50))');
    add_col_if_missing('RECOMMENDATION_SCORE',    'ALTER TABLE QA_RFQS ADD (RECOMMENDATION_SCORE NUMBER(5,2))');
    add_col_if_missing('RECOMMENDATION_REASON',   'ALTER TABLE QA_RFQS ADD (RECOMMENDATION_REASON VARCHAR2(500))');
    add_col_if_missing('RECOMMENDED_BY',          'ALTER TABLE QA_RFQS ADD (RECOMMENDED_BY VARCHAR2(255))');
    add_col_if_missing('RECOMMENDED_AT',          'ALTER TABLE QA_RFQS ADD (RECOMMENDED_AT TIMESTAMP)');
    add_col_if_missing('ALLOW_PARTIAL',           'ALTER TABLE QA_RFQS ADD (ALLOW_PARTIAL NUMBER(1) DEFAULT 0)');
    add_col_if_missing('APPROVED_BY',             'ALTER TABLE QA_RFQS ADD (APPROVED_BY VARCHAR2(255))');
    add_col_if_missing('APPROVED_AT',             'ALTER TABLE QA_RFQS ADD (APPROVED_AT TIMESTAMP)');

    COMMIT;
END;
/

-- FK for RECOMMENDED_VENDOR_ID (only if not already present)
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM USER_CONSTRAINTS
     WHERE TABLE_NAME = 'QA_RFQS' AND CONSTRAINT_NAME = 'FK_RFQ_REC_VENDOR';
    IF v_count = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE QA_RFQS ADD CONSTRAINT FK_RFQ_REC_VENDOR FOREIGN KEY (RECOMMENDED_VENDOR_ID) REFERENCES QA_VENDORS(VENDOR_ID)';
    END IF;
END;
/

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
  FROM USER_TAB_COLUMNS
 WHERE TABLE_NAME = 'QA_RFQS'
   AND COLUMN_NAME IN ('RECOMMENDED_VENDOR_ID','RECOMMENDATION_SCORE','RECOMMENDATION_REASON',
                       'RECOMMENDED_BY','RECOMMENDED_AT','ALLOW_PARTIAL','APPROVED_BY','APPROVED_AT')
 ORDER BY COLUMN_NAME;
