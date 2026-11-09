/**
 * Mailer Service for SecOps Multi-Layer Agent
 * Provides secure OTP dispatch via Email (SMTP / Sendmail)
 */
const nodemailer = require('nodemailer');
const config = require('./config');

class MailerService {
  constructor() {
    this.cachedTransporter = null;
  }

  getTransporter() {
    // 1. If custom SMTP configured
    if (config.smtpHost && config.smtpUser) {
      return nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: config.smtpSecure || (config.smtpPort === 465),
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    }

    // 2. If Gmail user & pass specified without explicit host
    if (config.smtpUser && config.smtpPass && config.smtpUser.includes('@gmail.com')) {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass
        }
      });
    }

    // 3. Fallback to local sendmail on Linux if available
    if (process.platform === 'linux') {
      try {
        const fs = require('fs');
        if (fs.existsSync('/usr/sbin/sendmail')) {
          return nodemailer.createTransport({
            sendmail: true,
            newline: 'unix',
            path: '/usr/sbin/sendmail'
          });
        }
      } catch {}
    }

    return null;
  }

  isConfigured() {
    return Boolean((config.smtpHost && config.smtpUser) || (config.smtpUser && config.smtpPass) || (process.platform === 'linux'));
  }

  /**
   * Kirim Kode OTP Verifikasi 2FA via Email
   */
  async send2FaOtpEmail({ to, otp, username, ip, userAgent }) {
    const targetEmail = to || config.adminEmail || 'agraphylearn@gmail.com';
    const transporter = this.getTransporter();

    if (!transporter) {
      throw new Error(
        `Layanan Email SMTP belum dikonfigurasi di file .env. ` +
        `Tambahkan SMTP_HOST, SMTP_USER, dan SMTP_PASS (App Password) untuk mengaktifkan pengiriman OTP ke ${targetEmail}.`
      );
    }

    const cleanUa = (userAgent || 'Web Browser').substring(0, 80);
    const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const senderFrom = config.smtpFrom || config.smtpUser || `SecOps Portal <secops@portal-egn.com>`;

    const subject = `🔐 [OTP SecOps] Kode Verifikasi Login Admin: ${otp}`;

    const textContent = 
`[ KODE VERIFIKASI 2FA SECOPS PORTAL ]
Kode OTP Rahasia Anda: ${otp}

Detail Permintaan Login:
- Pengguna: ${username || 'admin'}
- Alamat IP: ${ip || 'N/A'}
- Perangkat: ${cleanUa}
- Waktu: ${nowWib} WIB
- Masa Berlaku: 3 Menit

PERINGATAN KEAMANAN:
Jangan pernah memberikan kode OTP ini kepada siapa pun. Petugas SecOps tidak pernah meminta kode OTP Anda. Jika Anda tidak melakukan login, abaikan email ini dan amankan akun Anda segera.`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kode OTP Verifikasi SecOps</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 540px;
      margin: 0 auto;
      background-color: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .header {
      background: linear-gradient(135deg, #1f6feb 0%, #1158c7 100%);
      padding: 24px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0.5px;
      font-weight: 700;
    }
    .header p {
      margin: 6px 0 0 0;
      font-size: 13px;
      opacity: 0.9;
    }
    .content {
      padding: 28px 24px;
      text-align: center;
    }
    .notice {
      font-size: 14px;
      color: #8b949e;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .otp-box {
      background-color: #0d1117;
      border: 2px dashed #388bfd;
      border-radius: 10px;
      padding: 18px 24px;
      display: inline-block;
      margin: 10px 0 24px 0;
    }
    .otp-code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
      font-size: 36px;
      font-weight: bold;
      letter-spacing: 10px;
      color: #58a6ff;
      margin: 0;
    }
    .otp-expiry {
      margin-top: 8px;
      font-size: 12px;
      color: #f85149;
      font-weight: 600;
    }
    .metadata-card {
      background-color: #0d1117;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 14px;
      text-align: left;
      font-size: 12px;
      color: #8b949e;
      margin-top: 15px;
      line-height: 1.6;
    }
    .metadata-card strong {
      color: #c9d1d9;
    }
    .warning {
      background-color: rgba(248, 81, 73, 0.1);
      border-left: 4px solid #f85149;
      padding: 12px 14px;
      border-radius: 4px;
      font-size: 12px;
      color: #ff7b72;
      text-align: left;
      margin-top: 20px;
      line-height: 1.5;
    }
    .footer {
      background-color: #0d1117;
      border-top: 1px solid #21262d;
      padding: 16px;
      text-align: center;
      font-size: 11px;
      color: #6e7681;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ SECOPS EMERGENCY PORTAL</h1>
      <p>Verifikasi Otentikasi Dua Faktor (2FA)</p>
    </div>
    <div class="content">
      <p class="notice">
        Permintaan login otentikasi administrator terdeteksi. Gunakan kode OTP 6-digit di bawah ini untuk menyelesaikan otorisasi masuk:
      </p>

      <div class="otp-box">
        <div class="otp-code">${otp}</div>
        <div class="otp-expiry">⏳ Berlaku selama 3 Menit</div>
      </div>

      <div class="metadata-card">
        <div><strong>Pengguna:</strong> ${username || 'admin'}</div>
        <div><strong>Alamat IP:</strong> <code>${ip || 'N/A'}</code></div>
        <div><strong>Perangkat:</strong> ${cleanUa}</div>
        <div><strong>Waktu Permintaan:</strong> ${nowWib} WIB</div>
      </div>

      <div class="warning">
        ⚠️ <strong>PENTING:</strong> Jangan pernah membagikan kode OTP ini kepada siapa pun. Jika Anda tidak merasa melakukan percobaan login ini, seseorang mungkin mengetahui password Anda. Segera lakukan pergantian password dan isolasi akses.
      </div>
    </div>
    <div class="footer">
      Autonomous Multi-Layered SecOps Agent &bull; Zero-Trust Authorization System
    </div>
  </div>
</body>
</html>
`;

    const mailOptions = {
      from: senderFrom,
      to: targetEmail,
      subject,
      text: textContent,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      targetEmail
    };
  }
}

module.exports = new MailerService();
