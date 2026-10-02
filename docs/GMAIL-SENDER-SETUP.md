# CampusCare Gmail sender setup

Selected sender and initial test recipient: **24ug1bybs030@bmsit.in**. This uses the existing Google mailbox rather than DNS access to the college domain. It requires that the mailbox has Gmail enabled and that college policy permits this OAuth application. CampusCare's BMSIT eligibility rules remain separate from sender authorization.

## Google project and authorization client

1. Sign in to [Google Cloud](https://console.cloud.google.com/) with the selected account. Create/select the **CampusCare OTP Pilot** project and enable the Gmail API. Do not enable billing or the free trial for this setup.
2. Open **Google Auth Platform** and configure branding as **CampusCare**, with the selected account as support/contact email. Use **Internal** if the college organization permits it and only its accounts authorize the sender. Otherwise use **External** with the one sender as a test user. Students receiving codes do not authorize Gmail access and are not OAuth test users.
3. Configure only `openid`, `https://www.googleapis.com/auth/userinfo.email` (the `email` identity scope) and `https://www.googleapis.com/auth/gmail.send`. No Gmail read, modify or full mailbox scope is needed.
4. Create a **Desktop app** OAuth client named **CampusCare sender setup**. Download its client JSON. Keep it local; never paste it into chat, screenshots or Git. Save it as `.sites-runtime/gmail/client.json` in this checkout.
5. External applications in **Testing** receive refresh tokens that expire after seven days when Gmail sending is requested. This is suitable for initial delivery testing, not lasting operation. For the continuing pilot, resolve production publishing/verification and any college restrictions before obtaining the final authorization. Do not claim that switching to production makes the app verified. [Google's token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Local sender authorization

From the project directory, run:

```powershell
node scripts/authorize-gmail.mjs 24ug1bybs030@bmsit.in
```

Open the printed Google URL in a normal browser. Personally review and approve the request to send email and identify the sender account. The helper uses a one-time random state, S256 PKCE, a random-port HTTP listener bound exclusively to `127.0.0.1`, and fixed official Google endpoints. The authorization expires after ten minutes. A different or unverified Google account is rejected.

After successful authorization, credentials are written to a newly created private directory under `.sites-runtime/gmail/setup-<random-id>/authorized-sender.json`. On Windows the directory ACL grants access to the current Windows account and SYSTEM; on other platforms it uses owner-only permissions. The directory is ignored by Git. Credentials and authorization codes are never printed. The helper does not send email.

Transfer `GMAIL_CLIENT_ID` and `GMAIL_SENDER_EMAIL` to hosting runtime variables; transfer `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` as **secrets**. Set `OTP_MAIL_PROVIDER=gmail`. Preserve the existing `OTP_HMAC_SECRET` and `BMSIT_ADMIN_EMAIL`. Deploy a saved Site version to apply the new runtime revision. After confirming the secret upload, remove the temporary `authorized-sender.json` and downloaded client JSON with native file operations using their exact paths. Do not leave a second copy in Downloads or cloud-synced documents.

If Google refuses project creation or sender authorization, request the necessary college administrator approval or use a different account explicitly selected by the project owner. Do not bypass organization policy. Revocation, token expiry and quotas produce a generic delivery-unavailable response and invalidate the pending OTP.

## Real acceptance test

1. Sign in to the hosted CampusCare website with `24ug1bybs030@bmsit.in`. The server must identify that exact account. Before entering an emailed code, verification must be false and protected APIs must remain locked.
2. Request one OTP and record the request time and challenge ID without recording the code. HTTP success establishes provider acceptance only.
3. Check the actual BMSIT mailbox, including Spam. Confirm sender, recipient and request time. Enter the code **from the received message** within five minutes; do not read it from synthetic test fixtures, server logs or a provider request body.
4. Confirm the verified state and BMSIT workspace, reload to check session persistence, then sign out and confirm that protected access is locked again.
5. Record pass/fail, time, sender, recipient and observed delivery delay without storing OTPs or session tokens. Then validate an approved current student and the normal enrollment revocation flow.

Automated tests mock Google's HTTP responses. They establish provider integration, scope/identity checks and failure behavior; they cannot establish actual inbox delivery. Google authorization alone also does not complete this test.

References: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [OAuth for Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app), [OAuth consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
