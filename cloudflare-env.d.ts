declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BMSIT_ADMIN_EMAIL?: string;
    OTP_HMAC_SECRET?: string;
    RESEND_API_KEY?: string;
    OTP_FROM_EMAIL?: string;
  }
}
