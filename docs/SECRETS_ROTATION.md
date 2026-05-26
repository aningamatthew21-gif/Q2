# Secrets Rotation Runbook

**Owner:** Backend / DevOps
**Cadence:** Quarterly (calendar reminder) + immediately on suspected exposure
**Standards anchor:** ISO/IEC 27001:2022 A.5.17 (Authentication information), A.8.2 (Privileged access rights)

---

## When to rotate immediately (no waiting for the quarterly cycle)

- Any secret has been printed to a log, screenshot, or shared chat
- A developer leaves the team
- `.env` was committed to git (even briefly, even reverted) — git history still has it
- A dependency is compromised (npm supply-chain attack)
- The boot-time `secretsCheck` reports any critical failure
- A suspicious access pattern shows up in `QA_AUDIT_LOGS`

---

## Inventory — what we have

| Secret | Where it lives | What uses it | Impact if leaked |
|---|---|---|---|
| `JWT_SECRET` | `backend/.env` | Access-token signing | Attacker can forge any user's JWT → full account takeover |
| `JWT_REFRESH_SECRET` | `backend/.env` | Refresh-token signing | Persistent session takeover (longer-lived than access JWT) |
| `DB_PASSWORD` | `backend/.env` | Oracle pool auth | Full DB read/write access |
| `SMTP_PASS` | `backend/.env` | Gmail App Password for OTP delivery | Send arbitrary email from our address |
| `OPENROUTER_API_KEY` | `backend/.env` | AI chat feature | Billable LLM usage on our account |

---

## Rotation steps (per secret)

### `JWT_SECRET`

1. Generate a new value:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
2. Update `backend/.env` with the new value.
3. Restart the backend: `cd backend && npm run dev`.
4. **Side effect:** every existing JWT in users' browsers becomes invalid immediately. All users are forced to log in again. **Communicate before rotating in business hours.**
5. Verify: `node backend/utils/secretsCheck.js` (or simply observe boot log: `🔒 [secretsCheck] All secrets configured ✓`).

### `JWT_REFRESH_SECRET`

Same procedure as `JWT_SECRET`. Must differ from the access-token secret. Rotating this invalidates all refresh tokens — users must re-login but won't lose any in-flight work (just the auto-renewal stops).

### `DB_PASSWORD`

1. In SQL*Plus or SQL Developer connected as SYSTEM:
   ```sql
   ALTER USER QUOTEAPP IDENTIFIED BY "<NEW_PASSWORD_MIN_12_CHARS>";
   ```
2. Update `backend/.env` `DB_PASSWORD`.
3. Restart the backend.
4. Verify: the boot log should show `✅ [DB] Oracle connection pool initialized`.

### `SMTP_PASS` (Gmail App Password)

1. Visit https://myaccount.google.com/apppasswords (requires 2FA on the Gmail account).
2. Revoke the old App Password.
3. Create a new one labeled `MIDSA Quote App backend`.
4. Update `backend/.env` `SMTP_PASS` (paste with the spaces — Gmail format includes them).
5. Restart. Test OTP delivery by attempting to log in.

### `OPENROUTER_API_KEY`

1. Visit https://openrouter.ai/keys.
2. Revoke the old key.
3. Create a new one. Copy the `sk-or-v1-…` value.
4. Update `backend/.env` `OPENROUTER_API_KEY`.
5. Restart. Test AI chat in QuotingModule.

---

## Production deployment

The `secretsCheck.enforce()` call in `backend/server.js` **refuses to boot** when `NODE_ENV=production` and any critical secret check fails. This is intentional ISO 27001 "fail-secure" behaviour. The deployment runbook must include:

1. `.env` populated with real, strong values (NOT the `.env.example` placeholders)
2. `NODE_ENV=production` set
3. First boot attempt — verify no `[secretsCheck]` errors
4. If any warnings show, evaluate and either fix or accept-with-documentation

---

## Quarterly rotation calendar template

Add a recurring calendar event with this checklist:

- [ ] Generate new `JWT_SECRET`, deploy, force re-login
- [ ] Generate new `JWT_REFRESH_SECRET`, deploy
- [ ] Rotate `DB_PASSWORD` in Oracle + `.env`
- [ ] Rotate Gmail App Password
- [ ] Rotate OpenRouter API key
- [ ] Run `node backend/utils/secretsCheck.js` — expect clean exit
- [ ] Check `QA_AUDIT_LOGS` for any unexpected access in the past 90 days
- [ ] Update the ROTATION-LOG.md (sibling file) with date + rotator name

---

## Git history hygiene

This repo's `.gitignore` excludes `.env` and `backend/.env` from day one. To verify no past commits leaked them:

```bash
git log --all --full-history -- backend/.env
git log --all --full-history -- .env
```

If either command returns commits: the secrets in those commits are PUBLIC. Rotate immediately and consider a full BFG / `git filter-repo` history scrub (requires team coordination — every clone must be re-cloned).

---

## Related controls

- `backend/utils/secretsCheck.js` — boot-time enforcer
- `backend/.env.example` — placeholder template (safe to commit)
- ISO/IEC 27001:2022 Annex A.5.17, A.5.18, A.8.2, A.8.5
- OWASP ASVS v4.0 §2.4 (Credential Storage), §2.10 (Service Authentication)
