'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt (Node.js 14.10+) for unbiased range.
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999); // [100000, 999999]
}

module.exports = { generateOtp };
