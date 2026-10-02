declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BMSIT_ADMIN_EMAIL?: string;
    OTP_HMAC_SECRET?: string;
    RESEND_API_KEY?: string;
    OTP_FROM_EMAIL?: string;
    OTP_MAIL_PROVIDER?: 'resend' | 'gmail';
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    GMAIL_REFRESH_TOKEN?: string;
    GMAIL_SENDER_EMAIL?: string;
  }
}
