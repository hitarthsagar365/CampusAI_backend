const nodemailer = require('nodemailer');

/**
 * Send an email using Nodemailer with Brevo (formerly Sendinblue) SMTP
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Subject line
 * @param {string} options.text - Plain text body
 * @param {string} options.html - HTML body
 * @returns {Promise<Object>} Nodemailer sendMail info
 */
const sendEmail = async ({ to, subject, text, html }) => {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT, 10) || 587;
  const user = process.env.BREVO_SMTP_LOGIN;
  const pass = process.env.BREVO_SMTP_KEY;

  if (!user || !pass) {
    console.warn(
      '[sendEmail] Warning: BREVO_SMTP_LOGIN or BREVO_SMTP_KEY is not defined in environment variables.'
    );
  }

  // Create reusable transporter object using Brevo SMTP
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false, // port 587 uses STARTTLS
    auth: {
      user,
      pass
    },
    // Useful timeout settings for cloud deployment resilience
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  const senderName = process.env.FROM_NAME || 'Campus AI';
  const senderEmail = process.env.FROM_EMAIL || user || 'no-reply@campusai.com';

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to,
    subject,
    text,
    html
  };

  const info = await transporter.sendMail(mailOptions);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[sendEmail] Message sent: %s to %s`, info.messageId, to);
  }

  return info;
};

/**
 * Generate a responsive HTML template for password reset email
 *
 * @param {string} userName - Name of the user (or fallback)
 * @param {string} resetUrl - Complete reset password URL with token
 * @param {number} expireMinutes - Expiration time in minutes
 * @returns {string} HTML string
 */
const getPasswordResetTemplate = (userName, resetUrl, expireMinutes = 15) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 36px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                Campus AI
              </h1>
              <p style="margin: 8px 0 0 0; color: #e0e7ff; font-size: 14px;">
                Secure Password Reset
              </p>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600;">
                Hello ${userName || 'there'},
              </h2>
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                We received a request to reset the password for your Campus AI account. Click the button below to choose a new password:
              </p>

              <!-- Call to Action Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: #4f46e5;">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px; background-color: #4f46e5; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Notice Box -->
              <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 14px 16px; border-radius: 6px; margin: 24px 0;">
                <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                  <strong>Note:</strong> This link is valid for <strong>${expireMinutes} minutes</strong> only. If the link expires, you will need to submit a new password reset request.
                </p>
              </div>

              <!-- Fallback Link -->
              <p style="margin: 24px 0 8px 0; font-size: 13px; color: #64748b;">
                If the button above doesn't work, copy and paste this link into your web browser:
              </p>
              <p style="margin: 0; font-size: 12px; word-break: break-all; color: #4f46e5; background-color: #f8fafc; padding: 10px 12px; border-radius: 6px; border: 1px dashed #cbd5e1;">
                ${resetUrl}
              </p>

              <!-- Security Warning -->
              <p style="margin: 28px 0 0 0; font-size: 13px; line-height: 1.5; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                If you did not request this password reset, please ignore this email or reach out to your system administrator immediately. Your password will remain unchanged.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} Campus AI Management System. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

module.exports = {
  sendEmail,
  getPasswordResetTemplate
};
