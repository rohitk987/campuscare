# Acceptance checks performed

All browser tests used the local preview. Camera and geolocation were simulated for reproducibility; these results do not establish real campus GPS accuracy.

- TypeScript check: passed.
- Domain tests: 14 passed.
- Desktop dashboard, search, complaint detail, locations, people, reports and settings: opened without page errors.
- Mobile 390 px viewport: no document-level horizontal overflow in the checked locations view.
- Unconfigured site: new report blocked with an explanation.
- Configured test site: complete location check, floor/room selection, live-camera interface, JPEG capture and submission persisted a complaint and photo metadata.
- Outside-site coordinates: rejected by the backend.
- Missing photo: rejected by the backend.
- Anonymous API request: rejected.
- A ticket ID from a different organisation queried in the active organisation: returned not found.
- Replayed successful submission: returned the same ticket rather than creating another.
- Unverified complaint resolution: rejected.
- Workflow: verify → assign → start → hold → resume → resolve → close → request reopening → approve reopening persisted successfully.
- Remote reopening is a review request; it does not directly resume work.

Browser WebMCP registration is feature-detected. No supported WebMCP browser context was available for tool invocation validation; this is not required for normal use.

Before a real pilot, repeat tests with multiple actual authenticated accounts, physical devices, school/private-area cases, and your real site boundaries. Test backups, recovery and retention separately.

## CampusCare rename verification (2026-09-30)

- TypeScript check and all 14 domain tests passed again.
- Browser reporting flow passed against `/api/campuscare`, including camera capture, location validation, evidence persistence, repair actions, reopening, and access rejection checks.
- Page title, visible CampusCare branding, existing sample timeline actor labels, and `campuscare-complaints.csv` download name passed.
- New complaint numbers use `CC-`; existing identifiers and historical Git snapshots are preserved.
