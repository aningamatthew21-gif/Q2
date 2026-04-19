'use strict';

const nodemailer = require('nodemailer');

// ─── Create reusable transporter ────────────────────────────────────────────
// Uses Gmail SMTP with App Password.
// To generate a Gmail App Password:
//   1. Go to Google Account → Security → 2-Step Verification (must be ON)
//   2. Go to Google Account → Security → App Passwords
//   3. Select app: Mail, device: Windows Computer
//   4. Copy the 16-character password into your .env file
// ────────────────────────────────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true, // SSL
    auth: {
      user: process.env.SMTP_USER,  // Your Gmail address
      pass: process.env.SMTP_PASS,  // 16-char Gmail App Password (NOT your Gmail password)
    },
    // Connection pool for high-volume sending
    pool:           true,
    maxConnections: 5,
    maxMessages:    100,
  });

  return transporter;
}

/**
 * Send OTP email to user.
 * @param {string} toEmail  - Recipient email
 * @param {number} otpCode  - 6-digit OTP code
 * @param {string} userName - Display name (derived from email)
 */
async function sendOtpEmail(toEmail, otpCode, userName = '') {
  const t = getTransporter();

  const mailOptions = {
    from: {
      name:    'Margins ID Systems',
      address: process.env.SMTP_USER,
    },
    to:      toEmail,
    subject: '🔐 Your Login Code — Margins ID Quote System',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
          .container { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #1e3a5f, #2d6a9f); padding: 32px; text-align: center; }
          .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: 1px; }
          .body { padding: 32px; text-align: center; }
          .otp-code { font-size: 48px; font-weight: 700; letter-spacing: 12px; color: #1e3a5f; background: #f0f7ff; border: 2px dashed #2d6a9f; border-radius: 8px; padding: 20px 32px; display: inline-block; margin: 20px 0; }
          .note { color: #666; font-size: 13px; margin-top: 12px; }
          .footer { background: #f9f9f9; padding: 16px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MARGINS ID SYSTEMS</h1>
            <p style="color:#a8d0f0;margin:4px 0 0">Quote Management Portal</p>
          </div>
          <div class="body">
            <p style="color:#333;font-size:16px">Hello <strong>${userName || toEmail.split('@')[0]}</strong>,</p>
            <p style="color:#555;">Use the code below to complete your login:</p>
            <div class="otp-code">${otpCode}</div>
            <p class="note">⏱ This code expires in <strong>10 minutes</strong>.</p>
            <p class="note" style="color:#c0392b">If you did not request this, please ignore this email.<br>Do not share this code with anyone.</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Margins ID Systems Applications Ltd. &mdash; Accra, Ghana
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Your Margins ID login code is: ${otpCode}\nExpires in 10 minutes.`,
  };

  const info = await t.sendMail(mailOptions);
  console.log(`📧 [EMAIL] OTP sent to ${toEmail} — MessageID: ${info.messageId}`);
  return info;
}

/**
 * Verify the SMTP connection.
 * Called at startup to catch misconfiguration early.
 */
async function verifyEmailConfig() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️  [EMAIL] SMTP_USER or SMTP_PASS not set — email will NOT be sent');
    return false;
  }
  try {
    const t = getTransporter();
    await t.verify();
    console.log('✅ [EMAIL] Gmail SMTP connection verified');
    return true;
  } catch (err) {
    console.error('❌ [EMAIL] SMTP verification failed:', err.message);
    console.error('   Check SMTP_USER and SMTP_PASS in backend/.env');
    return false;
  }
}

/**
 * Send an RFQ invitation email to a vendor.
 * Vendors reply via email/phone — there is no portal in Phase 3.
 *
 * @param {object} opts
 * @param {string} opts.toEmail
 * @param {string} opts.vendorName
 * @param {string} opts.rfqNumber
 * @param {string} opts.deadline       Submission deadline (display string)
 * @param {Array}  opts.lineItems      [{ itemName, quantity, uom }]
 * @param {string} opts.replyToEmail   Buyer/procurement contact email
 * @param {string} [opts.notes]
 */
async function sendRfqEmail({ toEmail, vendorName, rfqNumber, deadline, lineItems, replyToEmail, notes }) {
  const t = getTransporter();

  const itemsHtml = (lineItems || []).map((li, i) => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
      <td style="padding:8px;border:1px solid #ddd;">${li.itemName}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${li.quantity || 1}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${li.uom || 'EA'}</td>
    </tr>
  `).join('');

  const mailOptions = {
    from: {
      name:    'Margins ID Systems — Procurement',
      address: process.env.SMTP_USER,
    },
    to:      toEmail,
    replyTo: replyToEmail || process.env.SMTP_USER,
    subject: `Request for Quotation — ${rfqNumber}`,
    html: `
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"><style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #1e3a5f, #2d6a9f); padding: 24px; text-align: center; color: #fff; }
        .body { padding: 24px; }
        .badge { display:inline-block; background:#fef3c7; color:#92400e; padding:4px 10px; border-radius:10px; font-size:12px; font-weight:600; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { background: #f0f7ff; padding: 8px; border: 1px solid #ddd; text-align: left; }
        .footer { background: #f9f9f9; padding: 16px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee; }
      </style></head><body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">REQUEST FOR QUOTATION</h1>
            <p style="margin:6px 0 0;color:#a8d0f0;">${rfqNumber}</p>
          </div>
          <div class="body">
            <p>Dear <strong>${vendorName}</strong>,</p>
            <p>Margins ID Systems Applications Ltd. invites you to submit a quotation for the items listed below.</p>
            <p><span class="badge">Submission Deadline: ${deadline}</span></p>
            <table>
              <thead><tr><th style="width:40px;text-align:center;">#</th><th>Item</th><th style="width:80px;text-align:center;">Qty</th><th style="width:60px;text-align:center;">UOM</th></tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
            <p>Please reply to this email with your <strong>unit price, lead time, delivery terms, payment terms,</strong> and quotation validity period.</p>
            <p>For questions, contact <a href="mailto:${replyToEmail || process.env.SMTP_USER}">${replyToEmail || process.env.SMTP_USER}</a>.</p>
            <p>Thank you,<br/>Procurement Team</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Margins ID Systems Applications Ltd. &mdash; Accra, Ghana
          </div>
        </div>
      </body></html>
    `,
    text: `Request for Quotation ${rfqNumber}\n\nVendor: ${vendorName}\nDeadline: ${deadline}\n\nItems:\n${(lineItems || []).map((li, i) => `${i + 1}. ${li.itemName} — Qty ${li.quantity || 1} ${li.uom || 'EA'}`).join('\n')}\n\nReply to: ${replyToEmail || process.env.SMTP_USER}`,
  };

  const info = await t.sendMail(mailOptions);
  console.log(`📧 [EMAIL] RFQ ${rfqNumber} sent to ${toEmail} — MessageID: ${info.messageId}`);
  return info;
}

module.exports = { sendOtpEmail, sendRfqEmail, verifyEmailConfig };
