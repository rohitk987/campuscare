# CampusCare BMSIT pilot completion audit

Checked 6 October 2026 (IST). Public entry point: [campuscare-dln.pages.dev](https://campuscare-dln.pages.dev).

## Current result

The public Pages address and direct email-code login are deployed. The application implements the requested maintenance workflow and BMSIT access restrictions. All 85 automated tests pass. Admitting real student reporters still requires institution-confirmed enrollment data and tested campus mappings; neither can be inferred reliably from the college's public website.

| Requirement | Evidence | Remaining live validation |
| --- | --- | --- |
| Address without `signaltradehq`, `workers` or `chatgpt.site` | Pages production deployment succeeded; the root page and login render at the new URL. | The free `.pages.dev` suffix remains. |
| Login without ChatGPT | Production access handlers use an email OTP and CampusCare session only; forged platform identity cannot authenticate. | Owner reported successful sign-in after the Pages test. The controlled Chrome tab was anonymous after refresh; confirm which browser/device held the successful session before concluding persistence is broken or fixed. |
| Real OTP delivery | Gmail sender is configured; earlier real receipt and verification confirmed. A fresh code request through Pages was accepted. | Independently inspecting the updated email's inbox layout has not been done. Do not collect the owner's code or inspect their private inbox. |
| Official BMSIT accounts and current students | Exact domain, approved student record, active batch dates and membership are checked on each protected API request. Explicitly approved staff also require OTP. | The real approved roster and batch access dates must come from the institution. The setup administrator has the configured exception until their own student record is added. |
| Remote progress access, on-site new reports | Tracking requires no GPS. Reporting checks fresh coordinates, accuracy, enabled site boundary and permitted building. Tests reject outside, stale, inaccurate and disabled-site readings. | Verify actual configured site/building boundaries and test a physical phone inside and outside them. |
| Floors and valid room choices | Rooms belong to the selected mapped building. Photo and complaint locations must match. | Confirm current floor/room names locally. GPS does not establish a floor. |
| Mandatory recent geotagged camera photo | Browser camera flow links JPEG capture to location metadata. API rejects missing evidence, mismatched building, wrong account, expired session and stale evidence; metadata and photo access are tested. | A real on-campus camera report remains unverified. Browser GPS and JPEG input can be forged; staff must verify whether the reported fault exists. |
| Student, verifier, administrator and technician workflow | Tests execute staff verification, assignment, start, hold, resolution, owner confirmation and staff-approved reopening with event history and version checks. | Institution must approve staff identities and scopes. |
| Private evidence | Photos require ownership or authorised staff access. Shared summaries do not disclose photos, descriptions or event notes to other reporters. | Confirm private areas and real staff scopes before collecting real photos. |

## Inputs required to finish the live pilot

1. An approved current-student list with official email, name, USN and batch, plus confirmed access dates. Enter these in **Student access**. Do not infer current enrollment from email prefixes or tentative academic calendars.
2. A site centre/radius and each building/zone's centre/radius, checked on campus. The administrator can use **Locations → Use current position** on a phone, then confirm the intended boundary before enabling reporting. Add valid floors and rooms. Map the off-site girls' hostel separately.
3. Approved verifier and maintenance identities and their site scopes, entered in **People**.
4. A physical-device acceptance run: sign in at the Pages address; refresh and confirm the dashboard remains accessible; make one authorised on-campus report; confirm an outside-campus new report is refused while progress remains accessible; have staff verify and resolve the test complaint; sign out and confirm protected access ends.

Published BMSIT contacts and facility names are already linked on the login page. [Official-site research](bmsit-campus-research.md) records their sources and explains why public map markers, historical room notices and graduation announcements do not establish safe geofences or an authoritative current-student roster.

## What this audit changed

Added seven reporting regressions to `tests/pilot-access.test.mjs`, using the production API handlers, transactional SQLite, synthetic mail and temporary photo storage. The complete 85-test suite passed. No production behavior, live roster, campus boundary or complaint was changed during this audit, so no new backend deployment was required.

The earlier Android device and reporting-preview results remain historical. They do not prove the current Pages login or GPS/camera behavior on a physical phone. The project is not marked complete while the live validation above remains outstanding.
