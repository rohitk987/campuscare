# CampusCare Android preview verification

Recorded on 1 October 2026 for version `0.1.0-preview` (`com.campuscare.app`).

## Direct email login update

On 6 October 2026, the source was updated to use CampusCare email OTP login and only the CampusCare logout endpoint. The older test results and APKs below predate that change. The WebView already opens the portal root and shares its session cookies.

## Current BMSIT access build

The first local BMSIT pilot APK is retained as `CampusCare-BMSIT-pilot.apk`. The current installable APK is built from GitHub Actions; the 0.1 GitHub release below remains historical.

- Debug APK assembly, instrumentation APK assembly, five access-policy unit tests and Android lint: **passed**.
- First pilot APK SHA-256: `58a9255e6be3b2c35dd80f4b00495d0323223094c33bd6eb5602a95817cdcfe5`.
- `NativeAccessTest`: **8 passed, 0 failed, 0 skipped** on the Android 15 / API 35 emulator.
- The eight tests execute the actual `ApiClient` and `AppState` against synthetic HTTP responses from device loopback. They cover protected-state clearing on HTTP 428 and enrollment revocation; ordinary permission errors; failed workspace verification; same-ID email changes; delayed data/cookie rejection; cancellation of old external and same-origin redirects; WebView cookie use; and OTP logout followed by platform logout, including OTP endpoint failure.
- No hosted mail, ChatGPT sign-in or live college data is used. Real email delivery and hosted WebView authentication remain unverified until sender credentials and institution-approved records are configured.
- The shared portal login page is public. Protected data requires exact-domain BMSIT identity, mailbox OTP, current enrollment or explicit staff approval, and active membership.

## Latest installable APK

- GitHub Actions run [38231647257](https://github.com/rohitk987/campuscare/actions/runs/38231647257) built commit `2f1cbfd711c43bddd569bca3068a4f134b8c56ca`: **success**.
- `:app:assembleDebug` passed on the GitHub Android runner. The installable `CampusCare-Android-BMSIT.apk` was downloaded from that run's artifact and checked as a valid APK archive with a manifest and DEX files.
- APK SHA-256: `774a019ee74222d5c0559780330f6cb2aae956b689187d100dc13d2157b5280e`.
- The compiled Android client contains the current `campuscare-dln.pages.dev` portal URL. It contains no `workers.dev` or `chatgpt.site` URL.
- This is a debug APK. The new Android build was compiled, but device installation, physical-phone OTP login, real-campus GPS and camera reporting have not been re-run.

## Historical first-preview results

The sections below record the earlier multi-organisation preview. Its backend identity, owner-private hosting policy, APK hash and workflow results do not describe the current BMSIT pilot build.

## Build and artifact

- JDK 17, Gradle 8.11.1, Android SDK 35; native Kotlin / Jetpack Compose application.
- `:app:assembleDebug`, `:app:assembleDebugAndroidTest`, and `:app:lintDebug`: **passed**.
- Android lint: **0 errors, 19 warnings**. The remaining warnings concern dependency updates, Kotlin/Compose style suggestions, and Android 12 backup configuration. This preview sets `allowBackup=false`; device-transfer behaviour still needs a production policy review.
- APK package and label verified with Android `aapt`: `com.campuscare.app`, **CampusCare**, minimum API 26 (Android 8), target API 35.
- Debug APK signature verified with `apksigner` (v2 signature).
- Delivered APK SHA-256: `7b46ffcf3269b4c2e416b802215fbb03730229620f5ca188b80cfb6178d7a053`.

## Executed integration checks

The final combined instrumentation run returned **OK (3 tests)** in 42.486 seconds on a Pixel 7 Android 15 emulator, against the existing local CampusCare HTTP backend and its D1/R2 development storage. Each test contains multiple assertions and requests.

| Test | What the executed test establishes |
| --- | --- |
| `ApiIntegrationTest.authenticatedClientHonoursTenantAndReportingGates` | Actual local WebView sign-in creates a session usable by native requests. Unknown and unauthorised workspaces are rejected. Unconfigured, off-site and stale-location reporting attempts fail. Submission without a photo fails. JPEG processing adds the expected EXIF coordinates, private upload/download round-trips, repeated submission is idempotent, and the verify → assign → start → hold → resume → resolve → close → reviewed reopening lifecycle succeeds. Logout invalidates the local session. |
| `MobileUiTest.nativeSignInNavigationAndReportingGate` | Native welcome/sign-in, Home, Helpdesk search, complaint details, reporting gate, Updates, Profile, Locations and sign-out operate through Compose UI actions. Recreating the activity retains the report screen. Screenshots are captured from the app's own Compose root. |
| `NativeReportFlowTest.reportUsesCameraLocationAndStaffVerification` | The actual emulator location provider passes the server's configured test boundary. Building/floor/room choices and text input reach the native camera step. Submission is disabled without photo evidence. The camera intent result is resized/geotagged and uploaded with another fresh location reading. Native submission creates a pending complaint with private evidence; the native staff action verifies it. |

The native report test replaces **only the external camera activity result** with a JPEG labelled `SIMULATED CAMERA · LOCAL TEST`. It does not replace the app's location provider, HTTP client, server validation, multipart upload, database writes, or staff workflow. The local test identity comes from the backend's development sign-in. It is not a production account or an app bypass.

Test code is compiled into a separate instrumentation APK and is absent from the delivered application APK. All synthetic reports and test boundaries are in the local **Android integration checks** office workspace. No live campus complaint was filed during testing.

The location test initially found a mismatch between its saved fixture boundary and emulator coordinates. Both now use `12.9716, 77.5946`, and the native fixture is refreshed before each run. No production location rule was relaxed.

## Visual verification

Inspected screenshots from the final application build: Home, filtered Helpdesk, and photo submission. They show CampusCare branding, workspace selection, yellow complaint actions, teal icons, card layouts, and Home / Helpdesk / Updates / Profile navigation. The screenshots in `docs/` contain fictional local records.

## Scope and remaining device checks

The automated run verifies the local native/backend integration. It does **not** establish successful hosted ChatGPT/MFA/SSO login, physical camera behaviour, real indoor GPS accuracy, or compatibility on every Android 8–15 device. Hosted access remains owner-private, and some authentication providers reject embedded WebViews. See the authentication section in the README before a live pilot.

New complaints always require location and photo evidence; existing complaint tracking remains available remotely. These checks support staff review and do not guarantee that every complaint or GPS reading is genuine. A real pilot must configure actual boundaries and verify the location/camera flow on the intended phones.

Use `scripts/test-local.ps1` with a local backend and emulator to repeat the suite. It maintains fresh emulator GPS readings for both reporting checks.
