-- ============================================================================
-- Phase 2 — Multi-Criteria Vendor Scoring
-- Idempotent seed of the 5 weight settings. Safe to run multiple times.
-- Run as: QUOTEAPP user in SQL Developer.
-- ============================================================================

-- Insert default weights only if missing (re-run safe)
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'scoreWeightPrice';
    IF v_count = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('scoreWeightPrice', '50');
    END IF;

    SELECT COUNT(*) INTO v_count FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'scoreWeightLeadTime';
    IF v_count = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('scoreWeightLeadTime', '20');
    END IF;

    SELECT COUNT(*) INTO v_count FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'scoreWeightRating';
    IF v_count = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('scoreWeightRating', '15');
    END IF;

    SELECT COUNT(*) INTO v_count FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'scoreWeightPaymentTerms';
    IF v_count = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('scoreWeightPaymentTerms', '10');
    END IF;

    SELECT COUNT(*) INTO v_count FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'scoreWeightCoverage';
    IF v_count = 0 THEN
        INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('scoreWeightCoverage', '5');
    END IF;

    COMMIT;
END;
/

-- Verify
SELECT SETTING_KEY, SETTING_VAL FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY LIKE 'scoreWeight%' ORDER BY SETTING_KEY;
