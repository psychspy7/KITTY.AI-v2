# KITTY AI validation report

Validation date: **5 October 2026**.

## Delivered and deployed

The complete Android app, backend, separate owner console, D1 schema, original icon and beginner guides are implemented. **KITTY AI 1.0.1 (versionCode 2)** is a minified owner-signed release connected to https://kitty-ai-v2.kitty-ai.workers.dev. It is installable and available from that site's downloads directory.

Cloudflare Workers and D1 are deployed in the owner's account. Migration 0001, VAULT_KEY and FIREBASE_WEB_API_KEY are configured. The Firebase CLI is signed in as the exact owner email. Google sign-in deployment succeeded, both permanent release fingerprints were registered and verified, and the Worker domain was added while preserving prior authorized domains. Refreshed Android configuration was fetched; its compiled authentication resource values are unchanged from the APK. A public Firebase configuration request returns HTTP 200 and confirms the Worker domain.

The owner completed Google sign-in to the KITTY console. Its exact Firebase UID was verified through Google's authenticated account lookup and configured as OWNER_UID in Cloudflare Secrets. Provider-key setup is deferred at the owner's explicit request; live chat remains paused. Phone Google login and live Groq/Gemini calls are **not claimed**.

## Verified checks

| Check | Evidence |
|---|---|
| Firebase configuration | Project, number, app ID, package and Web OAuth client match; refreshed JSON contains registered Android OAuth clients. |
| TypeScript | Backend and admin checks pass. |
| Backend tests | **19 pass** with real local Miniflare D1; identities/provider responses are simulated, signed JWT cases use generated RSA keys. |
| Backend deployment | Remote D1 migrations and Worker/static assets deployment succeed. |
| Live public/access smoke checks | Health and console HTTP 200; unauthenticated sync/admin HTTP 401; invalid bearer token HTTP 401; cross-origin API HTTP 403. These do not establish authenticated user/admin flows. |
| Android release | assembleRelease, testReleaseUnitTest and lintRelease succeed with Java 17, Gradle 8.13, AGP 8.13.2 and Kotlin 2.3.20. Minimum API 26, target/compile 35. |
| Android unit tests | **10 pass**, 0 skipped/failures/errors: history merge, trusted update URLs, known SHA-256 vector, update metadata, redirect hosts, package/version/signing-certificate rules and ambiguous URL rejection. |
| Android lint | **0 errors, 21 warnings**: SDK/dependency currency, resource configuration and KTX style suggestions. Not suppressed. |
| Signature | Packaged APK passes apksigner verification with a 3072-bit RSA owner certificate. Public fingerprints in OWNER-SIGNING.txt. |
| APK identity | com.kitty.ai, versionCode 2, versionName 1.0.1. APK is 3,526,075 bytes. |
| Public APK download | HTTP 200, APK MIME type, byte-for-byte equality with local signed build. SHA-256: 02ba4add9862ef92f04293ea9e4811344f08958c146b115fe3af0ecae231e937. |
| Packaged permissions | INTERNET, REQUEST_INSTALL_PACKAGES for explicit updates, ACCESS_NETWORK_STATE, Google READ_GSERVICES and app-specific receiver permission. No microphone, contacts, SMS, phone, accessibility or broad storage permission. |
| Emulator | Owner release installed and cold-launched on KittyQA, Android 15/API 35. Actual login screen captured at 320×640 in evidence/release-login.png and XML. No KITTY crash recorded. |

The emulator's initial boot temporarily lacked its settings provider and displayed a **System UI** ANR. After boot completed and the observed Wait button was selected, installation succeeded and KITTY's screen rendered. That OS incident and the slow host mean this is launch/installation evidence, not a phone performance benchmark. One release attempt failed on Windows Gradle-cache permissions; the corrected build passed. No such failed attempt is counted as a pass.

## Test scope

Backend tests cover exact owner UID plus exact verified email, failed-closed unset UID, non-Google/unverified rejection, audience/issuer/expiry validation, AES-GCM provider key isolation and masked responses, per-user data isolation, UTF-8 streaming, idempotent replay, conflicting request rejection, quotas, cancellation finalization, fallback before visible text, partial reply retention, consent withdrawal and individual example selection. Update publication requires a valid checksum and the configured repository URL. Gemini speech contract tests exercise the documented Interactions WAV request/response with store:false; they simulate responses. Official Groq model and Gemini TTS documentation was checked again on the validation date.

An attempted CLI Google OAuth credential exchange for an independent live owner-token check returned HTTP 400; it is not counted as an authenticated backend pass. The owner's browser sign-in and Google-linked UID lookup were successful. No token was printed or saved by that check.

The in-app updater is compiled into the release, uses private files, bounded downloads, explicit cancellation and persistence, and verifies downloaded identity and SHA-256 before opening Android's installer. The security decision rules are unit tested. A complete real GitHub download → permission prompt → installation flow has **not yet been tested**; it requires a newer release signed by this same key and a signed-in user. No silent update claim is made.

## Remaining live acceptance checks

1. Owner UID activation is complete. Refresh the console to confirm owner access. Verify an ordinary Google user receives HTTP 403 on owner routes.
2. Configure Groq and optional Gemini keys in the console, inspect account-supported models, then enable the service and test real streaming/audio calls. Keys must stay in the console/local prompts, never chat or APK resources.
3. On a Google Play services phone, test two accounts: separate history/memory, switching during streaming, cancellation/retry, quotas and service pause. The account fences and playback guards compile; these real flows are not established by launch tests.
4. Test speech play/stop/replacement/background behavior, notices/read state, individual consented examples and withdrawal.
5. Publish a higher-version APK in the new repository's GitHub Releases with its checksum, and test the complete in-app update flow.

Announcements are in-app Inbox messages; no background push is provided. Conversations are saved separately from model fine-tuning. No training job, background microphone or phone-control capability is included.

## Signing and security

No old owner key existed in the inspected project. A permanent release key was created and preserved under .tooling/signing, with a Windows DPAPI password and a private recovery password for other Windows accounts/computers. Key/password files are excluded from Git and source ZIPs. Back them up privately. This owner release cannot update the old debug-signed setup APK; uninstall the debug build once. Subsequent owner releases must keep this signing key.

Prompt control is protected by backend authorization; model obedience is not a security boundary. Prompt injection resistance and flawless responses are not guaranteed. This report does not claim full production readiness while the remaining account/provider/device checks are pending.
