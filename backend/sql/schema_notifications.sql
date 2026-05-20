-- ============================================================
-- NOTIFICATIONS — in-app notification centre
-- ============================================================
-- Run as the QUOTEAPP user. Safe to run once; for a re-runnable
-- version use:  node backend/migrate_notifications.js
--
-- One row PER RECIPIENT (so read/archive state is per-user). A single
-- business event (e.g. "invoice approved") fans out into N rows here,
-- one for each person who should be told.
-- ============================================================

CREATE TABLE QA_NOTIFICATIONS (
    NOTIF_ID      NUMBER         GENERATED ALWAYS AS IDENTITY,
    RECIPIENT     VARCHAR2(255)  NOT NULL,         -- user email this row belongs to
    TYPE          VARCHAR2(60)   NOT NULL,         -- e.g. 'invoice.approved', 'pr.created'
    TITLE         VARCHAR2(255)  NOT NULL,
    BODY          VARCHAR2(1000),
    SEVERITY      VARCHAR2(20)   DEFAULT 'info',   -- info | success | warning | critical
    CATEGORY      VARCHAR2(30)   DEFAULT 'system', -- invoices | procurement | inventory | finance | system
    ENTITY_TYPE   VARCHAR2(40),                    -- invoice | rfq | pr | inventory | quote | user
    ENTITY_ID     VARCHAR2(120),
    LINK_PAGE     VARCHAR2(60),                    -- AppContext page key to deep-link to
    LINK_CONTEXT  VARCHAR2(2000),                  -- JSON pageContext (e.g. {"invoiceId":"…"})
    ACTOR         VARCHAR2(255),                   -- who triggered the event
    GROUP_KEY     VARCHAR2(160),                   -- collapses duplicate unread alerts
    IS_READ       NUMBER(1)      DEFAULT 0,
    READ_AT       TIMESTAMP,
    IS_ARCHIVED   NUMBER(1)      DEFAULT 0,         -- soft-delete ("delete" in the UI)
    CREATED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP,
    CONSTRAINT PK_NOTIFICATIONS PRIMARY KEY (NOTIF_ID),
    CONSTRAINT CHK_NOTIF_READ     CHECK (IS_READ IN (0,1)),
    CONSTRAINT CHK_NOTIF_ARCHIVED CHECK (IS_ARCHIVED IN (0,1))
);

-- Hot path: "my unread, newest first"
CREATE INDEX IDX_NOTIF_RECIPIENT ON QA_NOTIFICATIONS(RECIPIENT, IS_ARCHIVED, IS_READ);
CREATE INDEX IDX_NOTIF_CREATED   ON QA_NOTIFICATIONS(CREATED_AT);
-- De-dup lookup: "is there already an unread alert with this group key for this user?"
CREATE INDEX IDX_NOTIF_GROUP     ON QA_NOTIFICATIONS(RECIPIENT, GROUP_KEY, IS_READ);

COMMIT;
