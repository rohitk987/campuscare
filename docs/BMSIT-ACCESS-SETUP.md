# BMSIT email verification and current-student access

The application now requires three separate checks: a trusted sign-in identity using an exact BMSIT domain, a current approved enrollment record, and a code delivered to that same mailbox. An email prefix or admission year is never treated as proof of enrollment.

## Email delivery setup

The adapter uses Resend's [Send Email API](https://resend.com/docs/api-reference/emails/send-email). Configure these runtime values through hosting environment management, never in Git or `.openai/hosting.json`:

| Key | Required value |
| --- | --- |
| `BMSIT_ADMIN_EMAIL` | `24ug1bybs030@bmsit.in`, the designated setup administrator |
| `OTP_HMAC_SECRET` | A securely generated secret of at least 32 characters; already configured for the hosted pilot |
| `RESEND_API_KEY` | An API key from the email-service account used for this pilot |
| `OTP_FROM_EMAIL` | An approved sender mailbox on a domain verified with Resend |

Resend requires [domain verification](https://resend.com/docs/dashboard/domains/introduction). The sender domain can differ from the recipient's college domain. Do not configure a `bmsit.in` or `bmsit.ac.in` sender unless its DNS owner has authorised and completed verification. A service testing address is not a substitute for a verified pilot sender.

Deploy the current saved version after changing hosted environment values. Until sender configuration is present, the verification screen explains that delivery is unavailable and keeps access locked. There is no universal test OTP, development bypass or code returned by the API.

## Approve current students

1. The designated administrator signs in through ChatGPT using the confirmed BMSIT address, then verifies the emailed OTP. Initial setup access is reserved for that address; the first visitor does not become administrator.
2. Open **Student access** and add the institution-confirmed batches. Set admission year, access start date, access end date and whether the batch is enabled. Date inputs use Indian Standard Time; access ends after the selected end date.
3. Add each current student from the official college list with name, exact official email, USN, batch and enrollment status. Emails and USNs are unique within BMSIT. Search checks the full server roster by name, email or USN; use Previous/Next page for the 100-record pages. Unlisted accounts cannot request an OTP for CampusCare access.
4. Add the setup administrator's own student record if that administrator is a student. Once a student record exists, its eligibility takes precedence over an administrative role. Arrange an approved continuing administrator before that student's access ends.
5. Use **People** to approve maintenance staff and verifiers with official college emails and appropriate site scopes. Explicitly approved staff need OTP but are not required to have a student batch. A staff member who also has an inactive student record remains blocked until the administrator corrects the verified enrollment record.
6. Mark graduates as `graduated`, withdrawn students as `withdrawn` and suspended students as `suspended`. Disable a whole batch when needed. No student can edit these records or access dates.

Student eligibility is checked on every protected server request, including complaint tracking and evidence access. Batch expiry therefore blocks an existing verified session without waiting for logout or a scheduled job. Membership deactivation also blocks subsequent requests, including attempts to sign in again under the same account with a changed email. Records and complaint history are retained.

## Student workflow

Sign in with the BMSIT account → server checks exact domain and current enrollment → request a six-digit email code → enter the latest code → access the BMSIT workspace. Login and tracking work off campus. New reports still require the existing on-site location and fresh camera checks.

Codes expire after five minutes, are single use, and allow at most five verification attempts. Sending has a one-minute cooldown and a five-code-per-hour limit per authenticated account. The server stores only a keyed hash of the code and a hash of the eight-hour verification session token. The browser token is in a Secure, HttpOnly, SameSite cookie; sign-out revokes it server-side.

## Verification before admitting real users

The automated API tests use synthetic mail delivery and temporary SQLite data. They do not prove real mailbox delivery or correctness of the institution's roster.

- Configure the verified sender and test actual delivery to the designated BMSIT administrator.
- Enter institution-confirmed batch dates and approved current-student records; no real roster or graduation dates have been guessed or seeded.
- Check one approved student's successful sign-in, an unlisted account's refusal, and revocation after marking the test record inactive.
- Confirm official staff roles and campus reporting boundaries before accepting real complaints.

The native Android client shares these server restrictions, so it cannot bypass OTP. The current source clears protected state on OTP expiry and enrollment revocation, prevents stale response and cookie restoration, and revokes the OTP token on sign-out. Its sign-in WebView can display the website's verification screen and shares cookies with native requests; the **Check sign-in** control can retry after completing verification. Five access-policy unit tests and eight Android 15 device tests pass. The device tests use synthetic loopback responses and establish native state/cookie/logout behavior; they do not prove actual hosted email delivery or WebView authentication. The real-mail flow still needs validation with the configured sender and approved student records.
