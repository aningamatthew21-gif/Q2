'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { generateOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/email');

const router = express.Router();

/**
 * Extract role from existing user, or assign 'sales' by default.
 */
async function getOrAssignUserRole(email) {
  const result = await execute(
    'SELECT USER_ROLE, USER_NAME FROM QA_USERS WHERE USER_EMAIL = :email',
    { email }
  );
  if (result.rows && result.rows.length > 0) {
    return {
      role: result.rows[0].USER_ROLE,
      name: result.rows[0].USER_NAME
    };
  }
  return { role: 'sales', name: null };
}

/**
 * POST /api/auth/send-otp
 * Generates an OTP, stores it in Oracle, and sends it via Nodemailer
 */
router.post('/send-otp', catchAsync(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalizedEmail = email.trim().toLowerCase();
  const rawOtp = generateOtp();

  // Upsert OTP into QA_OTPS
  await execute(`
    MERGE INTO QA_OTPS dest
    USING (SELECT :email AS email, :otp AS otp FROM DUAL) src
    ON (dest.OTP_EMAIL = src.email)
    WHEN MATCHED THEN
      UPDATE SET OTP_CODE = src.otp, 
                 CREATED_AT = SYSTIMESTAMP,
                 EXPIRES_AT = SYSTIMESTAMP + INTERVAL '10' MINUTE
    WHEN NOT MATCHED THEN
      INSERT (OTP_EMAIL, OTP_CODE) VALUES (src.email, src.otp)
  `, { email: normalizedEmail, otp: rawOtp });

  // Get user name for email greeting (if exists)
  const user = await getOrAssignUserRole(normalizedEmail);

  // Send the actual email
  // If no SMTP config provided yet, we fall back to console logging
  try {
    await sendOtpEmail(normalizedEmail, rawOtp, user.name);
  } catch (err) {
    console.error('Failed to send email. Check SMTP settings.');
    // Keep rawOtp in console so developer can login when SMTP is disabled
    console.log(`[DEV OTP] Log in with: ${rawOtp}`); 
  }

  res.json({ success: true, message: 'OTP generated and sent.' });
}));

/**
 * POST /api/auth/verify-otp
 * Validates OTP against Oracle DB. If valid, issues JWT and deletes OTP.
 */
router.post('/verify-otp', catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  const normalizedEmail = email.trim().toLowerCase();

  // Validate OTP
  const result = await execute(`
    SELECT OTP_CODE FROM QA_OTPS 
    WHERE OTP_EMAIL = :email 
      AND SYSTIMESTAMP < EXPIRES_AT
  `, { email: normalizedEmail });

  if (!result.rows || result.rows.length === 0) {
    return res.status(400).json({ error: 'OTP expired or not found' });
  }

  const storedOtp = result.rows[0].OTP_CODE;

  // Compare strictly as numbers/strings
  if (String(storedOtp) !== String(otp)) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  // Delete validated OTP
  await execute('DELETE FROM QA_OTPS WHERE OTP_EMAIL = :email', { email: normalizedEmail });

  // Ensure user exists in QA_USERS
  const userRes = await execute('SELECT * FROM QA_USERS WHERE USER_EMAIL = :email', { email: normalizedEmail });
  
  let role = 'sales';
  let name = normalizedEmail.split('@')[0];

  if (userRes.rows && userRes.rows.length > 0) {
    role = userRes.rows[0].USER_ROLE;
    name = userRes.rows[0].USER_NAME || name;
  } else {
    // Create new user automatically (replicating Firebase anonymous/lazy auth flow)
    await execute(`
      INSERT INTO QA_USERS (USER_EMAIL, USER_ROLE, USER_NAME) 
      VALUES (:email, 'sales', :name)
    `, { email: normalizedEmail, name: name });
  }

  // Generate JWT token
  const token = jwt.sign(
    { email: normalizedEmail, role, name, uid: normalizedEmail },
    process.env.JWT_SECRET || 'fallback-secret-for-dev',
    { expiresIn: '24h' }
  );

  res.json({
    success: true,
    token,
    user: {
      email: normalizedEmail,
      role,
      name,
      uid: normalizedEmail
    }
  });
}));

/**
 * GET /api/auth/me
 * Retrieves current user payload using Bearer token
 */
router.get('/me', authMiddleware, catchAsync(async (req, res) => {
  res.json({ success: true, user: req.user });
}));

module.exports = router;
