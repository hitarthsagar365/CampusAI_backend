const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const mongoose = require('mongoose');

const User = require('../models/User');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Admin = require('../models/Admin');
const Session = require('../models/Session');
const PasswordReset = require('../models/PasswordReset');

/**
 * Helper to construct the branded CampusAI HTML email
 */
const getResetPasswordEmailHtml = ({ resetUrl, userName }) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your CampusAI Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 36px 32px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.18); border-radius: 14px; padding: 10px 14px; margin-bottom: 12px; border: 1px solid rgba(255, 255, 255, 0.25);">
                      <span style="font-size: 24px; line-height: 1;">🎓</span>
                    </div>
                    <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">CampusAI</h1>
                    <p style="color: rgba(255, 255, 255, 0.85); font-size: 13px; margin: 4px 0 0 0; font-weight: 400;">Academic Excellence Platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0;">Password Reset Request</h2>
              
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px 0;">
                Hello${userName ? ` <strong>${userName}</strong>` : ''},
              </p>

              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px 0;">
                We received a request to reset your password for your <strong>CampusAI</strong> account. Click the button below to set a new password:
              </p>

              <!-- Action Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 14px 0 rgba(79, 70, 229, 0.35);">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry Alert -->
              <div style="background-color: #f1f5f9; border-left: 4px solid #6366f1; border-radius: 8px; padding: 12px 16px; margin: 24px 0;">
                <p style="font-size: 12px; color: #334155; margin: 0; line-height: 1.5;">
                  ⏱️ <strong>This reset link will expire in 15 minutes</strong> for security reasons.
                </p>
              </div>

              <!-- Fallback Link -->
              <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 24px 0 0 0;">
                If the button above does not work, copy and paste this link into your browser:
              </p>
              <p style="font-size: 11px; line-height: 1.4; color: #4f46e5; word-break: break-all; margin: 6px 0 0 0;">
                <a href="${resetUrl}" style="color: #4f46e5; text-decoration: underline;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
              <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 0 0 8px 0;">
                If you did not request a password reset, you can safely ignore this email. Your current password remains secure and unchanged.
              </p>
              <p style="font-size: 11px; color: #94a3b8; margin: 0;">
                &copy; ${new Date().getFullYear()} CampusAI. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

/**
 * Helper to dispatch email via Brevo HTTP API
 */
const sendBrevoEmail = async ({ toEmail, toName, subject, htmlContent }) => {
  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();

  if (!brevoApiKey || brevoApiKey === 'your_brevo_api_key_here') {
    console.warn('[CampusAI Brevo API] WARNING: BREVO_API_KEY environment variable is not set.');
    throw new Error('BREVO_API_KEY is missing or invalid in server environment variables.');
  }

  const senderEmail = (process.env.BREVO_FROM_EMAIL || '').trim();
  if (!senderEmail || senderEmail === 'support@campusai.edu') {
    throw new Error('BREVO_FROM_EMAIL is not configured with your verified Brevo email.');
  }
  const senderName = 'CampusAI';

  const payload = {
    sender: {
      name: senderName,
      email: senderEmail
    },
    to: [
      {
        email: toEmail,
        name: toName || 'CampusAI User'
      }
    ],
    subject: subject,
    htmlContent: htmlContent
  };

  const response = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: 10000
  });

  return response.data;
};

/**
 * @desc    Request password reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        message: 'Please provide a valid email address.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Find user by email in the unified User model
    let user = await User.findOne({
      email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') }
    });

    // Fallback: Check Student, Faculty, Admin models if separate records exist
    if (!user && Student) {
      user = await Student.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    }
    if (!user && Faculty) {
      user = await Faculty.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    }
    if (!user && Admin) {
      user = await Admin.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    }

    // Generic response message returned regardless of user existence (security best practice)
    const genericSuccessMessage = 'If an account with that email exists, a reset link has been sent.';

    if (!user) {
      // Do not reveal whether email exists in database
      return res.status(200).json({ message: genericSuccessMessage });
    }

    // 2. Generate 32-byte cryptographically secure random hex token
    const rawToken = crypto.randomBytes(32).toString('hex');

    // 3. Hash the token with SHA-256 before storing
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 4. Create record in PasswordReset model with 15-minute expiration
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Clean up any pending reset tokens for this user
    await PasswordReset.deleteMany({ userId: user._id });

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      email: cleanEmail,
      expiresAt
    });

    // 5. Construct reset URL
    const frontendBaseUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      'http://localhost:5173'
    ).replace(/\/+$/, '');

    const resetUrl = `${frontendBaseUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(cleanEmail)}`;

    console.log(`[CampusAI Forgot Password] Reset link created for ${cleanEmail}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CampusAI Reset URL (Dev)]: ${resetUrl}`);
    }

    // 6. Send email via Brevo HTTP API
    try {
      const emailHtml = getResetPasswordEmailHtml({
        resetUrl,
        userName: user.name || ''
      });

      await sendBrevoEmail({
        toEmail: cleanEmail,
        toName: user.name || 'CampusAI User',
        subject: 'CampusAI - Password Reset Request',
        htmlContent: emailHtml
      });
    } catch (emailError) {
      const detailedMessage =
        emailError.response?.data?.message ||
        emailError.message ||
        'Check your Brevo API key and verified sender email.';
      console.error('[CampusAI Brevo Error]: Failed to send password reset email:', emailError.response?.data || emailError.message);
      return res.status(500).json({
        message: `Brevo Error: ${detailedMessage}`
      });
    }

    // 7. Return generic success message
    return res.status(200).json({ message: genericSuccessMessage });

  } catch (error) {
    console.error('Error in forgotPassword handler:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error processing password reset.'
    });
  }
};

/**
 * @desc    Submit new password using reset token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, email, newPassword, password } = req.body;
    const finalPassword = newPassword || password;

    if (!token) {
      return res.status(400).json({
        message: 'Password reset token is required.'
      });
    }

    if (!finalPassword) {
      return res.status(400).json({
        message: 'New password is required.'
      });
    }

    if (finalPassword.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long.'
      });
    }

    // 1. Hash the incoming token with SHA-256
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    // 2. Query criteria: match tokenHash and ensure not expired
    const query = {
      tokenHash,
      expiresAt: { $gt: new Date() }
    };

    if (email && email.trim()) {
      query.email = email.trim().toLowerCase();
    }

    const resetRecord = await PasswordReset.findOne(query);

    if (!resetRecord) {
      return res.status(400).json({
        message: 'Invalid or expired password reset link. Please request a new one.'
      });
    }

    // 3. Hash the new password with bcrypt (10 salt rounds used throughout CampusAI auth)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(finalPassword, salt);

    // 4. Update the user password in User model
    const user = await User.findById(resetRecord.userId);
    if (user) {
      user.passwordHash = hashedPassword;
      user.password = hashedPassword;
      try {
        await user.save();
      } catch (saveError) {
        await User.findByIdAndUpdate(resetRecord.userId, {
          passwordHash: hashedPassword,
          password: hashedPassword
        });
      }
    } else {
      await User.findByIdAndUpdate(resetRecord.userId, {
        passwordHash: hashedPassword,
        password: hashedPassword
      });
    }

    // Also update Student / Faculty / Admin documents if separate collections are present
    if (Student) {
      await Student.findByIdAndUpdate(resetRecord.userId, { password: hashedPassword, passwordHash: hashedPassword });
    }
    if (Faculty) {
      await Faculty.findByIdAndUpdate(resetRecord.userId, { password: hashedPassword, passwordHash: hashedPassword });
    }
    if (Admin) {
      await Admin.findByIdAndUpdate(resetRecord.userId, { password: hashedPassword, passwordHash: hashedPassword });
    }

    // 5. Invalidate ALL active sessions for that user
    await Session.deleteMany({ userId: resetRecord.userId });

    try {
      if (mongoose.connection && mongoose.connection.collection) {
        await mongoose.connection.collection('sessions').deleteMany({
          'session.user._id': resetRecord.userId.toString()
        });
      }
    } catch (_) {
      // Ignore if session collection is managed differently
    }

    // 6. Delete the used PasswordReset token record
    await PasswordReset.deleteMany({ userId: resetRecord.userId });

    // 7. Return success message
    return res.status(200).json({
      message: 'Password reset successful. Please login with your new password.'
    });

  } catch (error) {
    console.error('Error in resetPassword handler:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error completing password reset.'
    });
  }
};

