# MIDSA Quote App — Disaster Recovery Runbook

**Version:** 1.0 (Sprint 4)
**Last updated:** 2026-05-26
**Owner:** IT Operations

**Standards anchor:**
- **ISO/IEC 27001:2022 A.5.30** — ICT readiness for business continuity
- **ISO/IEC 27001:2022 A.8.13** — Information backup
- **ISO/IEC 27001:2022 A.8.14** — Redundancy of information processing facilities
- **ISO/IEC 27001:2022 A.5.29** — Information security during disruption

---

## 1. Service-Level Objectives

| Metric | Target | Definition |
|---|---|---|
| **RPO** (Recovery Point Objective) | **24 hours** | Maximum tolerable data loss measured in time. Daily backups satisfy this. |
| **RTO** (Recovery Time Objective) | **4 hours** | Maximum tolerable downtime from incident declaration to service restoration. |
| **MTPD** (Maximum Tolerable Period of Disruption) | **24 hours** | After which the organisation may suffer unacceptable damage. |

> **RPO drives backup frequency.** RTO drives restore-procedure design.
> Both must be tested at least **quarterly** against this runbook.

---

## 2. What Gets Backed Up

| Asset | Backup type | Frequency | Retention | Owner |
|---|---|---|---|---|
| Oracle `QUOTEAPP` schema | `expdp` data-pump full export | **Daily 02:00 UTC** | 14 daily + 12 monthly | DBA |
| Backend `.env` (secrets) | Encrypted GPG → offline vault | On change | Forever | IT Security |
| Uploaded attachments (BLOBs in `QA_RFQ_RESPONSE_ATTACHMENTS`) | Included in schema export | Daily | Same as schema | DBA |
| Application code | Git remote (GitHub) | On every commit | Forever | Engineering |
| Audit logs (`QA_AUDIT_LOGS`, `QA_OTP_AUDIT`) | Included in schema export | Daily | **7 years** (Ghana Companies Act + GRA) | DBA |
| Docker images | Image registry tag retention | On every release | Last 10 versions | DevOps |

---

## 3. Backup Procedure (current production)

### 3.1 Oracle schema dump (runs daily via Windows Task Scheduler)

```powershell
# C:\Scripts\midsa-daily-backup.ps1 — schedule for 02:00 UTC daily
$stamp = Get-Date -Format "yyyy-MM-dd"
$dir   = "D:\Backups\midsa\$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null

# Oracle Data Pump export (faster + more portable than legacy `exp`)
expdp QUOTEAPP/$env:DB_PASSWORD@XEPDB1 `
  SCHEMAS=QUOTEAPP `
  DIRECTORY=DATA_PUMP_DIR `
  DUMPFILE=midsa_$stamp.dmp `
  LOGFILE=midsa_$stamp.log `
  EXCLUDE=STATISTICS

# Move the dump out of the Oracle directory to our backup tree
Move-Item "C:\app\oracle\admin\XE\dpdump\midsa_$stamp.dmp" $dir
Move-Item "C:\app\oracle\admin\XE\dpdump\midsa_$stamp.log" $dir

# Compress + upload to off-site (S3 / Azure Blob / etc.)
Compress-Archive -Path "$dir\midsa_$stamp.dmp" -DestinationPath "$dir\midsa_$stamp.zip"
aws s3 cp "$dir\midsa_$stamp.zip" "s3://midsa-dr-backups/oracle/" --storage-class STANDARD_IA

# Prune local copies older than 14 days
Get-ChildItem D:\Backups\midsa | Where-Object {
  $_.PSIsContainer -and $_.LastWriteTime -lt (Get-Date).AddDays(-14)
} | Remove-Item -Recurse -Force
```

> **Verification:** Every backup is automatically validated by
> `backend/verify_backup.js` — see §5. A backup that hasn't been
> restore-tested in the last 30 days is treated as **untrusted**.

### 3.2 Secrets vault

`.env` is stored in **1Password / Bitwarden** under `Vault: MIDSA-Prod`.
Every secret rotation (per `docs/SECRETS_ROTATION.md`) creates a new
vault entry with the rotation date in the title.

---

## 4. Disaster Scenarios + Recovery Procedures

### 4.1 Application server died (Docker host crashed)

**Detection:** Health-check probe fails for >3 minutes.
**RTO:** 30 minutes.

```bash
# 1. Spin up a fresh host (any Docker 24+ box). Restore secrets.
git clone https://github.com/midsa/quote-app.git
cd quote-app
# Pull .env from the vault and place at the repo root
docker compose --env-file .env up -d --build

# 2. Verify health
curl http://localhost:3001/api/health?deep=1
# Expect: {"status":"healthy",...,"db":{"reachable":true,...}}

# 3. Update DNS / load-balancer to point at the new host
```

### 4.2 Oracle DB corruption / data loss

**Detection:** `/api/health?deep=1` returns `503`, DBA reports corruption.
**RTO:** 4 hours.

```powershell
# 1. Identify the most recent verified backup (see §5)
$latest = Get-ChildItem D:\Backups\midsa | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# 2. Stop the application so no new writes hit the (possibly damaged) DB
docker compose stop backend

# 3. Drop and recreate the QUOTEAPP schema
sqlplus sys/$env:DB_SYSPASS@XEPDB1 as sysdba <<SQL
  DROP USER QUOTEAPP CASCADE;
  CREATE USER QUOTEAPP IDENTIFIED BY $env:DB_PASSWORD
    DEFAULT TABLESPACE USERS
    QUOTA UNLIMITED ON USERS;
  GRANT CONNECT, RESOURCE, CREATE VIEW, CREATE SEQUENCE TO QUOTEAPP;
  EXIT;
SQL

# 4. Import the dump
impdp QUOTEAPP/$env:DB_PASSWORD@XEPDB1 `
  DIRECTORY=DATA_PUMP_DIR `
  DUMPFILE=midsa_$latest.dmp `
  LOGFILE=restore_$latest.log

# 5. Restart the application
docker compose start backend

# 6. Smoke test
node backend/smoke_test_reports.js
```

### 4.3 Entire data centre / cloud region offline

**Detection:** Customer can't reach any service for >15 minutes.
**RTO:** 4 hours (assumes off-site backup is intact in S3 / Azure Blob).

1. Provision new infrastructure in the secondary region (Terraform / IaC).
2. Pull latest dump from S3: `aws s3 cp s3://midsa-dr-backups/oracle/latest.zip .`
3. Follow steps 3–6 of §4.2.
4. Update DNS A-records to point at the new region.

### 4.4 Ransomware / malicious code execution

**Detection:** Audit log anomaly, file integrity monitor alert.
**RTO:** 6–24 hours.

1. **Do NOT restore from the most recent backup** — it may contain the malware.
2. Work backwards through backups until you find one prior to the
   compromise (use `QA_AUDIT_LOGS` to identify time-of-attack).
3. Restore per §4.2, but use the older clean backup.
4. Rotate ALL secrets per `docs/SECRETS_ROTATION.md` before bringing the
   app back online.
5. Force-revoke every refresh token: `DELETE FROM QA_REFRESH_TOKENS`.
6. Notify affected users (legal requirement under Ghana DPA).

---

## 5. Backup Verification (mandatory monthly)

A backup that has never been restore-tested is a backup that doesn't exist.

```bash
# Manual verification — runs against a scratch schema, leaves prod untouched
cd backend
node verify_backup.js D:\Backups\midsa\2026-05-25\midsa_2026-05-25.dmp
```

Expected output:

```
▶ Verifying backup: midsa_2026-05-25.dmp
  ✓ Dump file exists + non-empty (1,234 MB)
  ✓ impdp dry-run parsed all DDL
  ✓ Imported into VERIFY_QUOTEAPP scratch schema
  ✓ QA_INVOICES row count: 5,123 (match within 1% of source)
  ✓ QA_AUDIT_LOGS row count: 87,234
  ✓ QA_RFQ_RESPONSE_ATTACHMENTS BLOB integrity OK
  ✓ Scratch schema dropped
✅ Backup verified — safe to restore from
```

**Schedule:** every 30 days, on the 1st of the month. Logged to
`D:\Backups\midsa\verification.log` + emailed to DBA + IT Security.

---

## 6. DR Drill Schedule

Per ISO 27001 A.5.30 — **untested DR is not DR.**

| Drill | Frequency | Owner | Last run |
|---|---|---|---|
| Full simulated DB restore (§4.2) | Quarterly | DBA | _next: 2026-08-01_ |
| App server failover (§4.1) | Quarterly | DevOps | _next: 2026-08-15_ |
| Region failover (§4.3) | Annually | DevOps + IT Security | _next: 2026-12-01_ |
| Tabletop ransomware exercise (§4.4) | Annually | IT Security + Executive | _next: 2026-10-01_ |
| Backup verification (§5) | **Monthly** | DBA | _automated_ |

After each drill, update this runbook with any procedure gaps found.

---

## 7. Contact Tree

| Role | Primary | Secondary | After-hours |
|---|---|---|---|
| Incident commander | _[name]_ | _[name]_ | _[phone]_ |
| DBA on-call | _[name]_ | _[name]_ | _[phone]_ |
| Network/Infra | _[name]_ | _[name]_ | _[phone]_ |
| IT Security | _[name]_ | _[name]_ | _[phone]_ |
| Executive (above 4-hour outage) | _[name]_ | _[name]_ | _[phone]_ |

*Fill in real names + numbers before the next DR drill.*

---

## 8. Document History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-05-26 | SP4 | Initial runbook (Sprint 4 production readiness) |
