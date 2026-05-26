'use strict';

/**
 * fileValidator.js — server-side file upload defence-in-depth.
 *
 * Standards anchor:
 *   - OWASP File Upload Cheat Sheet (2025) — magic-byte signature check,
 *     MIME allowlist, size cap; never trust the client-supplied MIME or
 *     filename extension alone.
 *   - ISO/IEC 27001 A.8.7 (Malware protection) — verify uploaded content
 *     matches its declared type before persisting.
 *   - ISO/IEC 27001 A.8.10 (Information deletion) — paired with retention
 *     guarantees from soft-delete pattern elsewhere.
 *
 * Design: pure-Node magic-byte sniffer for the 4 MIME types we accept on
 * vendor RFQ attachments (PDF, PNG, JPEG, HEIC). No npm dep — avoids the
 * `file-type` v22 ESM-only mismatch with this CJS backend and keeps the
 * supply chain attack surface at zero.
 *
 * Usage:
 *   const { validateAttachmentBuffer } = require('../utils/fileValidator');
 *   const verdict = validateAttachmentBuffer(buffer, claimedMime, claimedName);
 *   if (!verdict.ok) return res.status(400).json({ success:false, error: verdict.reason });
 */

// Hard cap per attachment. Frontend enforces 10 MB in FileDropzone; we
// enforce the same server-side so a crafted POST can't slip something
// larger past the dropzone. Express's body-parser limit is also 10 MB,
// which prevents 13 MB base64-bloated uploads from even reaching here —
// but this is the defence-in-depth backstop.
const MAX_BYTES = 10 * 1024 * 1024;

// MIME allowlist — the exact set FileDropzone offers users to choose.
// Each entry pairs the declared MIME with the magic-byte detector that
// proves the bytes actually ARE that format.
const SIGNATURES = [
  {
    mime: 'application/pdf',
    detect: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
    // "%PDF"
  },
  {
    mime: 'image/png',
    detect: (b) => b.length >= 8
      && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
      && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
    // \x89 PNG \r \n \x1A \n
  },
  {
    mime: 'image/jpeg',
    detect: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF
    // SOI marker
  },
  {
    mime: 'image/jpg',  // alias accepted by FileDropzone — same magic as jpeg
    detect: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF
  },
  {
    mime: 'image/heic',
    detect: (b) => {
      // HEIC/HEIF wraps in an ISO base media container — magic at offset 4
      // is "ftyp" followed by a brand identifier. Accept any of the common
      // HEIC brand codes (heic, heix, hevc, hevx, heim, heis, hevm, hevs, mif1).
      if (b.length < 12) return false;
      const isFtyp = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
      if (!isFtyp) return false;
      const brand = b.slice(8, 12).toString('ascii').toLowerCase();
      return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1'].includes(brand);
    }
  }
];

// MIME → human label for clearer error messages
const MIME_LABEL = {
  'application/pdf': 'PDF',
  'image/png':       'PNG',
  'image/jpeg':      'JPEG',
  'image/jpg':       'JPEG',
  'image/heic':      'HEIC'
};

/**
 * Validate a single attachment Buffer.
 *
 * Checks (defence-in-depth, in order):
 *   1. Empty buffer → reject (caller probably saw a decode failure)
 *   2. Size cap     → reject anything > 10 MB
 *   3. MIME allowlist → reject types we don't accept
 *   4. Magic-byte detection → reject if real format doesn't match the claim
 *
 * @param {Buffer} buffer  - decoded file bytes
 * @param {string} claimedMime - the MIME the client sent (from File API)
 * @param {string} claimedName - the filename the client sent (for messages)
 * @returns {{ ok: boolean, reason?: string, detectedMime?: string }}
 */
function validateAttachmentBuffer(buffer, claimedMime, claimedName) {
  const name = String(claimedName || 'attachment');

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: `"${name}" is empty or could not be decoded.` };
  }
  if (buffer.length > MAX_BYTES) {
    return {
      ok: false,
      reason: `"${name}" is ${(buffer.length / 1024 / 1024).toFixed(2)} MB; max allowed is 10 MB.`
    };
  }

  const claim = String(claimedMime || '').toLowerCase();
  const allowedMimes = SIGNATURES.map(s => s.mime);
  if (!allowedMimes.includes(claim)) {
    return {
      ok: false,
      reason: `"${name}" has unsupported type "${claim || 'unknown'}". Allowed: ${allowedMimes.join(', ')}.`
    };
  }

  // Magic-byte detection — find a signature that matches the actual bytes
  const detected = SIGNATURES.find(s => s.detect(buffer));
  if (!detected) {
    return {
      ok: false,
      reason: `"${name}" failed magic-byte check — claimed ${MIME_LABEL[claim] || claim} but bytes don't match any allowed format.`
    };
  }

  // Cross-check: detected format must equal the claimed one (or its alias).
  // jpeg ↔ jpg considered equivalent per SIGNATURES table.
  const equiv = (a, b) => {
    if (a === b) return true;
    const pair = [a, b].sort().join('|');
    return pair === 'image/jpeg|image/jpg';
  };
  if (!equiv(detected.mime, claim)) {
    return {
      ok: false,
      reason: `"${name}" claimed ${MIME_LABEL[claim] || claim} but actual content is ${MIME_LABEL[detected.mime] || detected.mime}.`
    };
  }

  return { ok: true, detectedMime: detected.mime };
}

module.exports = { validateAttachmentBuffer, MAX_BYTES, SIGNATURES };
