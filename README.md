# SiteCare

A working multi-organisation facility reporting and maintenance prototype for colleges, schools, offices and other managed sites.

## What is implemented

- Separate organisation workspaces with server-checked memberships and site scopes.
- Fictional college, school and office sample workspaces, clearly labelled as demos.
- Remote login and complaint tracking; location checks apply only to new reports.
- Admin-configured circular site and building boundaries, with floor and room selection.
- Mandatory browser camera capture linked to fresh browser geolocation.
- Private image storage and permission-checked image delivery.
- Duplicate suggestions and following existing shared issues.
- Staff verification, clarification, assignment, start/hold/resume/resolve/close actions.
- Reviewed reopening of the same incident with retained event history.
- Member approval, scoped staff roles, and membership deactivation.
- In-app updates to the reporter, operational metrics and CSV export.
- Organisation settings for name, accent colour, review target, accuracy limit and emergency instructions.

## Implementation stack

The hosted implementation uses **TypeScript, React, Vinext and a Cloudflare Worker**, with **D1** for relational data and **R2** for photos. This differs from the Django/PostgreSQL stack proposed during design so the complete app can run on the supplied Sites hosting platform. It is a server-backed application; localStorage is not the database.

Authentication is **dispatch-owned ChatGPT sign-in**. It is not a custom college-email/password or institutional SSO implementation. Organisation membership is checked separately from sign-in. An administrator approves the email a member will use to sign in; this version does not send invitation or verification emails. A user must also have access to the deployed Site, which is private to its owner by default.

## First use

1. Sign in. A first-time account without an approved membership receives three private demo workspaces.
2. Open the organisation selector in the sidebar. Explore the sample complaint workflows or create a new workspace.
3. In **Locations**, add a site using its centre latitude/longitude and radius. Enable reporting when the approved boundary is correct.
4. Add buildings/zones with their own centre and radius, followed by floors/rooms/areas. `Outdoor` can be used as a level. Individual asset inventories and QR labels are not required.
5. In **Settings**, configure emergency instructions, location accuracy tolerance and a review target. Test location behaviour on the actual site.
6. In **People**, approve users and assign roles/site access. Sample maintenance users use `example.invalid` addresses and cannot sign in.
7. A member selects **Report an issue**, passes the location check, chooses the exact area, describes the fault and captures a photo. Evidence expires two minutes after receipt, and reporting sessions expire after 15 minutes.
8. A verifier checks the issue. An administrator assigns it; maintenance staff update progress. The reporter can confirm resolution or request reopening from anywhere.

Sample workspaces deliberately have **unconfigured reporting boundaries**. They do not silently claim a user is on a real campus. Existing sample tickets have no fabricated GPS/photo evidence. New reports, even inside a demo workspace, must pass the actual application checks.

## Local development

Use Node.js 22.13+ (Node 24+ recommended), npm, and a browser with camera/location support.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flaky_talisman.sql
npm run dev
```

Apply each migration once, in filename order. The local server normally prints `http://127.0.0.1:5173/`. In development, `/signin-with-chatgpt?return_to=/` supplies the starter's local test identity. That development identity mechanism is excluded from production builds. Never expose the local development server as a public production service.

If the Windows npm command shim fails, invoke its JavaScript entrypoint using your installed Node/npm paths, or use `node scripts/run-framework.mjs dev` after dependencies have been installed.

Local camera access works on loopback in supporting browsers. Other devices need a properly secured HTTPS deployment; ordinary HTTP over a LAN is not sufficient.

## Validation

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/domain.test.mjs
npm run build
```

The included 14 domain tests cover location freshness/accuracy/boundaries, building ambiguity, site scope, role restrictions and state transitions. Browser/API checks performed during the build are recorded in `tests/acceptance.md`.

## Application structure

```text
app/sitecare.tsx                 workspace UI, navigation and dashboards
app/report-dialog.tsx           reporting wizard and camera/location capture
app/ticket-sheet.tsx             evidence review, actions and history
app/admin-dialog.tsx             site, building, room and member configuration
app/api/sitecare/route.ts        authenticated API, access checks and persistence
app/chatgpt-auth.ts              platform authentication integration
lib/domain.ts                   pure location and workflow rules
lib/server.ts                   prepared D1 statements and authorisation helpers
lib/seed.ts                     fictional demo data, isolated per account
db/schema.ts                    schema definitions
drizzle/                        generated schema migrations
tests/domain.test.mjs            security and workflow unit tests
```

## Data and access rules

- Requests are authenticated by the hosting dispatcher; organisation IDs supplied by clients are only selectors. An active membership is required on every tenant-specific request.
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

## Demo walkthrough

Switch among **Northstar Institute**, **Cedar Grove School** and **Meridian Offices** to show configuration and data separation. Review a sample pending complaint, assign it, progress the repair, resolve it, and record a reopening review. Then demonstrate a new report on a deliberately configured test site, explaining that browser locations are supporting evidence rather than anti-spoofing guarantees.
