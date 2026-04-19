-- ============================================================
-- STEP 1: Run this file FIRST, connected as SYSDBA
-- In SQL Developer: Connect as user=sys, role=SYSDBA
-- Then run this entire script once.
-- ============================================================

-- Switch to the pluggable database (Oracle XE default)
ALTER SESSION SET CONTAINER = XEPDB1;

-- Create dedicated schema user for the Quote App
CREATE USER quoteapp IDENTIFIED BY "QuoteApp2024#Secure!"
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP;

-- Grant all necessary privileges
GRANT CONNECT, RESOURCE TO quoteapp;
GRANT CREATE TABLE TO quoteapp;
GRANT CREATE SEQUENCE TO quoteapp;
GRANT CREATE TRIGGER TO quoteapp;
GRANT CREATE VIEW TO quoteapp;
GRANT CREATE PROCEDURE TO quoteapp;
GRANT UNLIMITED TABLESPACE TO quoteapp;

-- Allow session-level operations
GRANT CREATE SESSION TO quoteapp;

COMMIT;

-- Verify
SELECT USERNAME, ACCOUNT_STATUS, DEFAULT_TABLESPACE
FROM DBA_USERS
WHERE USERNAME = 'QUOTEAPP';
