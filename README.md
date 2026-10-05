# CampusCare

A facility reporting and maintenance portal, currently restricted to the **BMSIT pilot**. The underlying organisation model is retained for future rollouts.

[Hosted preview](https://campuscare-facility-hub.sepia-pastime9v.chatgpt.site) · [GitHub source](https://github.com/rohitk987/campuscare)

## Android app

The native Android client is in [`android/`](android/README.md). It uses Kotlin and Jetpack Compose, with a MyGate-inspired home, Helpdesk, Updates and Profile interface. It connects to this backend for reporting, evidence, staff workflows and administration. The Android README contains installation, authentication limitations, build and emulator-test instructions.

## What is implemented

- Exactly one accessible organisation: BMSIT, with server-checked memberships and site scopes.
- Email OTP verification for exact `@bmsit.in` and `@bmsit.ac.in` accounts, with rate limits and single-use expiring codes.
- Admin-approved student records and active batches with access start/end dates; graduated, suspended, withdrawn and unlisted students are denied.
- Reporter enrollment only after both current-student approval and email verification. Explicitly approved staff roles also require OTP.
- Server rejection of other domains, legacy organisations, demo seeding and new organisation creation.
- Remote login and complaint tracking; location checks apply only to new reports.
- Admin-configured circular site and building boundaries, with floor and room selection.
- Mandatory browser camera capture linked to fresh browser geolocation.
- Private image storage and permission-checked image delivery.
- Duplicate suggestions and following existing shared issues.
- Staff verification, clarification, assignment, start/hold/resume/resolve/close actions.
- Reviewed reopening of the same incident with retained event history.
- Scoped staff roles and membership deactivation; deactivated accounts cannot enroll again automatically.
- In-app updates to the reporter, operational metrics and CSV export. Complaint history is filtered by permission before retrieval, then read in 100-row database batches without a global 500-record cutoff.
- Organisation settings for accent colour, review target, accuracy limit and emergency instructions; the pilot name stays BMSIT.

## Implementation stack

The hosted implementation uses **TypeScript, React, Vinext and a Cloudflare Worker**, with **D1** for relational data and **R2** for photos. This differs from the Django/PostgreSQL stack proposed during design so the complete app can run on the supplied Sites hosting platform. It is a server-backed application; localStorage is not the database.

Authentication uses **direct BMSIT email and OTP sign-in**. Visitors enter their college email, receive a six-digit code and verify it without a ChatGPT account. Only exact `bmsit.in` or `bmsit.ac.in` domains are accepted. All protected API operations derive identity from a hashed, expiring server session and recheck current eligibility. Platform identity headers and browser-supplied user IDs or roles cannot authenticate a visitor. Existing member IDs retain complaint ownership, staff roles, follows and notifications.

The shared login page can be opened by link; complaints, evidence and administration require a BMSIT identity, email OTP, current eligibility and the appropriate active membership. GPS is requested only for new complaints, never for sign-in or tracking.

The initial administrator's official email is configured through the hosted secret `BMSIT_ADMIN_EMAIL`. It is never supplied by the browser. The first ordinary visitor never becomes administrator. Other approved current students become reporters after OTP verification; pre-approved staff invitations retain their assigned roles. Existing inactive or already-claimed invitations cannot be reclaimed.

## First use

1. Gmail sender authorization, the administrator address and OTP hashing secret are configured for the hosted pilot. A live send and receipt in the BMSIT inbox were confirmed on 2 October 2026; the owner confirmed receipt and verification during the earlier sender setup. Repeat the mailbox test for this updated direct login flow. Follow [BMSIT access setup](docs/BMSIT-ACCESS-SETUP.md).
2. Enter the designated administrator's BMSIT email directly on the sign-in form and verify the emailed code. In **Student access**, configure the confirmed current batches and approved student records. Students need an active record, an enabled batch within its dates and a mailbox OTP before enrollment.
3. In **Locations**, add a site using its centre latitude/longitude and radius. Enable reporting when the approved boundary is correct.
4. Add buildings/zones with their own centre and radius, followed by floors/rooms/areas. `Outdoor` can be used as a level. Individual asset inventories and QR labels are not required.
5. In **Settings**, configure emergency instructions, location accuracy tolerance and a review target. Test location behaviour on the actual site.
6. In **People**, add staff roles/site access using official BMSIT emails before those staff members first sign in. Student eligibility requires an approved roster record; staff roles are explicitly approved. Member deactivation immediately blocks subsequent API access.
7. A member selects **Report an issue**, passes the location check, chooses the exact area, describes the fault and captures a photo. Evidence expires two minutes after receipt, and reporting sessions expire after 15 minutes.
8. A verifier checks the issue. An administrator assigns it; maintenance staff update progress. The reporter can confirm resolution or request reopening from anywhere.

BMSIT starts without invented coordinates or sample complaints. Configure real site/building boundaries and rooms before reporting. Previous demo data is retained in storage but inaccessible during the pilot.

## Local development

Use Node.js 22.13+ (Node 24+ recommended), npm, and a browser with camera/location support.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flaky_talisman.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_rare_wind_dancer.sql
npm run dev
```

Apply each migration once, in filename order. The local server normally prints `http://127.0.0.1:5173/`. Local platform-auth emulation is disabled. `tests/pilot-access.test.mjs` exercises real API handlers, cookie authentication and SQLite with synthetic mail delivery; no identity substitute or universal code is shipped. Configure the sender and administrator through the local Worker environment and use HTTPS to exercise the Secure session cookie. Never expose the local development server as a public production service.

If the Windows npm command shim fails, invoke its JavaScript entrypoint using your installed Node/npm paths, or use `node scripts/run-framework.mjs dev` after dependencies have been installed.

Local camera access works on loopback in supporting browsers. Other devices need a properly secured HTTPS deployment; ordinary HTTP over a LAN is not sufficient.

## Validation

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.mjs
npm run build
```

The 14 domain tests cover location and workflow rules. Forty-two pilot access tests execute the actual API handlers and SQL against transactional SQLite with synthetic email delivery. They cover exact domains, current enrollment, OTP expiry/attempts/concurrency/replay/rate limits, secure session cookies, logout, administrator permissions, revocation, identity binding, and direct attempts to access legacy organisations or create demos. Gmail tests cover verified sender matching, scope checks, revoked authorization, identity-service failure, rejected delivery and configuration/header validation. Roster search runs on the server and returns pages of 100 records, so administrators can find and suspend records beyond the original 2,000-row limit. Four client tests check cross-tab account switching and delayed responses without allowing old privileged data to return. Four OAuth setup tests check Desktop client parsing, state/PKCE, callback validation and token/identity checks. Two additional tests execute the production mail adapter inside workerd and reject redirects without forwarding credentials. Three history regressions cover older complaints behind 600 inaccessible reports, 605 accessible reports with equal timestamps, and technician/site privacy. The 66 automated tests use synthetic provider responses. The owner confirmed receipt and verification during the earlier sender setup. The updated direct login must also be checked in a real browser with the emailed code. See [Gmail sender setup](docs/GMAIL-SENDER-SETUP.md). Earlier multi-organisation acceptance results are historical; the current pilot policy takes precedence.

## Application structure

```text
app/campuscare.tsx                 workspace UI, navigation and dashboards
app/report-dialog.tsx           reporting wizard and camera/location capture
app/ticket-sheet.tsx             evidence review, actions and history
app/admin-dialog.tsx             site, building, room and member configuration
app/api/campuscare/route.ts        authenticated API, access checks and persistence
lib/account.ts                  verified mailbox identity type
lib/domain.ts                   pure location and workflow rules
lib/server.ts                   prepared D1 statements and authorisation helpers
lib/pilot.ts                    fixed BMSIT organisation and exact email-domain policy
lib/access.ts                   email OTP, session and enrollment eligibility checks
app/api/access/route.ts          OTP and administrator-only student/batch API
app/access-panel.tsx             mailbox verification and student access screens
lib/seed.ts                     historical demo helpers; not reachable from the pilot API
db/schema.ts                    schema definitions
drizzle/                        generated schema migrations
tests/domain.test.mjs            security and workflow unit tests
```

## Data and access rules

- Requests are authenticated by the hosting dispatcher; organisation IDs supplied by clients are only selectors. Every protected request requires exact-domain identity, a verified OTP session, current student eligibility or explicit staff approval, and active membership.
- Organisation administrators and verifiers see records within their authorised scopes. Technicians can act on their own assigned jobs. Reporters can see their own tickets and limited shared summaries.
- Evidence, detailed reporter information and event notes are hidden from other ordinary members. School submissions and private-area submissions are forced private.
- All writes require the application request header and a same-origin check when an Origin header is present. Database values use prepared statements.
- Capture sessions are user-bound and expire. A unique session-to-complaint relationship prevents duplicate submission. Ticket updates use version checks to prevent lost concurrent updates.
- Status changes and audit events are written in a D1 batch. Students cannot set their own verified status or reopen directly into active repair.
- CSV output protects against spreadsheet formula injection.

## Prototype boundaries before a paid rollout

This is a functional prototype, not a claim of production certification.

- GPS is an estimate and can be manipulated. The camera-only interface is not hardware attestation. Geotagging links reported coordinates to evidence; it does not prove physical presence or a genuine fault. Staff verification remains required.
- The implemented geofences are circles, not surveyed polygons or indoor floor positioning. Real campuses need on-site validation and may benefit from polygon support.
- The current category catalogue is shared; configurable category templates, teams/routing rules, bulk roster import, logo upload and institutional SSO are follow-up extensions.
- In-app notifications are implemented for reporters. Following currently provides a followed-issues view; follower-specific notifications, email/SMS, scheduled reminders and automatic escalations are not implemented.
- Subscription billing, payment collection, custom domains and a platform-wide commercial administration console are not implemented.
- This build does not configure automated backups, restores, retention jobs or orphan-upload cleanup. Establish and test these before collecting real evidence at scale. Protect credentials, configure customer access, and review applicable institutional requirements before a pilot.
- Production deployment uses logical `DB` and `BUCKET` bindings in `.openai/hosting.json`; Sites provisions resources and applies migrations. Existing migration history must not be rewritten after deployment.

## Earlier previews

The Android first-preview release and its recorded tests predate the BMSIT restriction. Its native client uses the same server, so the current domain, OTP, enrollment and organisation restrictions also apply to it. The older organisation-creation controls cannot bypass the server's pilot policy. Its sign-in WebView shares cookies with native requests and can show the website's verification screen, followed by **Check sign-in**. The native client now clears protected state on OTP expiry or enrollment revocation, discards previous-session responses and cookies, and revokes the OTP session before platform sign-out. The current APK build, five access-policy unit tests, eight Android 15 device tests and Android lint pass. The device tests use synthetic loopback HTTP responses to exercise state clearing, identity changes, cookie sharing, logout and stale redirects. Hosted email sending and BMSIT inbox receipt were confirmed on 2 October 2026; actual hosted code verification and device sign-in remain unverified; historical Android results do not establish current login readiness. Repeating the historical Android multi-organisation tests requires their tagged source/backend, not the restricted pilot backend.
