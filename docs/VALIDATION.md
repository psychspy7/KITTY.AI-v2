# KITTY AI validation report

Validation date: **5 October 2026**. Release **1.0.3 / versionCode 4**.

## Findings and changes

The previous login handler could silently swallow a Credential Manager cancellation, leaving the same login page. The new handler displays persistent errors and Firebase error codes, and waits until the activity resumes before exchanging native Google credentials. Login attempts are serialized; the initial null Firebase listener no longer resets an active attempt.

A secure browser option uses the existing Firebase project's first-party Hosting domain. Its single-use handoff expires after ten minutes, encrypts the Google credential in D1, requires an app-private PKCE proof, and checks the resulting Firebase UID. Polling pauses behind the browser and resumes when KITTY returns. Tokens are never in the return link. The emulator exposed background DNS failures; the observed foreground resume did not repeat that error. The original phone's exception was not captured, so these findings do not establish its exact cause.

The live groq-main provider was configured with **canopylabs/orpheus-v1-english**, a speech model. It now uses **openai/gpt-oss-120b**, preserving the encrypted key. Live model lookup and a synthetic streamed answer returned HTTP 200 and [DONE]. The free Cloudflare fallback also returned a finished live synthetic stream. These are provider tests, not a complete authenticated Android chat test.

## Verified checks

| Check | Result |
|---|---|
| Firebase | Project/app/package/Web OAuth client match; Google provider enabled, release/debug certificates registered, both deployed origins accepted by a public configuration request (HTTP 200). |
| Owner | Exact Google-linked UID WCppLHxijDcNqVTxAQkONUrApFm1 and exact verified owner email required by the backend; OWNER_UID remains a secret. |
| TypeScript | Backend/admin checks pass. |
| Backend tests | **33 pass** using real local Miniflare D1. Identities/provider responses simulated; JWT cases use generated RSA signatures. |
| Deployment | Worker, D1 migrations 0001/0002, AI binding, console, APK and static Firebase login Hosting deployed. |
| Providers | Saved Groq key: models and finished synthetic stream pass. Cloudflare: finished synthetic stream passes. No credential printed. |
| Android build | assembleRelease, testReleaseUnitTest, lintRelease pass. Java 17, Gradle 8.13, AGP 8.13.2, Kotlin 2.3.20; min API 26, target/compile 35. |
| Android tests | **13 pass**, zero failures/errors/skips: history merge, PKCE RFC vector/proof generation, SHA-256, trusted URLs, update metadata and package/version/certificate rules. |
| Lint | **0 errors, 24 warnings**, retained: dependency/SDK currency, style and resource suggestions. |
| Signature | apksigner verifies preserved RSA 3072-bit owner key. SHA-256 certificate: 047129a730f0686d4f83f1d89d690811f5d7f91e09cd283cb9fdfff0a14661d1. |
| APK | com.kitty.ai, code 4, name 1.0.3; **3,542,551 bytes**. |
| Download | HTTP 200, APK MIME, byte-for-byte equality with local signed APK. SHA-256: f7873810db3140734e8e92b87e2e8ae0b72945a71eb21cd30baeb36a174864fb. |
| Permissions | INTERNET, explicit-update REQUEST_INSTALL_PACKAGES, ACCESS_NETWORK_STATE, Google READ_GSERVICES and app-specific receiver permission. No microphone, contacts, SMS, phone, accessibility or broad storage permission. |
| Emulator | Release 1.0.3 installed/cold-launched on Android 15/API 35. Login and persistent Google cancellation captured in evidence/release-1.0.3-*.png/xml; no KITTY crash recorded. Browser handoff resumes after foreground return and process restart, then explicit cancellation restores the login buttons. |

## Scope and remaining acceptance

Backend tests cover exact owner identity, unset UID, Google/verified email requirements, token audience/issuer/expiry, encrypted/masked keys, user separation, UTF-8 streaming, idempotency, conflicting requests, quotas, cancellation, fallback before visible text, partial replies, consent withdrawal and selected examples. New cases cover PKCE, browser expiry/cancel/replay, simultaneous one-time consumption, anonymous limits, Google JWT verification, narrow Firebase CORS, redirects, Cloudflare context/cancellation and rejection of speech models for Groq chat.

**The owner confirmed that release 1.0.3 reaches the chat screen after Google sign-in on the phone.** This is user-reported acceptance, without an instrumented phone trace; the native/browser route was not specified. An actual completed Android chat reply still needs confirmation. The test browser returned Firebase auth/network-request-failed before opening Google; separate HTTPS configuration checks accepted both deployed origins. That browser failure is recorded separately from the successful phone report.

Gemini speech tests simulate the documented API; no live Gemini key/audio test was completed. Direct Cloudflare inference plus adapter tests do not establish a production Groq-failure-to-Cloudflare transition. Real two-account switching during streaming, speech replacement/background behavior, notices and consent review still need device acceptance.

The updater verifies SHA-256, package, increasing version and exact certificate, with bounded private downloads and cancellation. Trusted sources are the pinned KITTY APK path and owner's GitHub Releases. Release 1.0.3 metadata is published. A complete signed-in download → Android permission prompt → installation flow remains unverified. Android confirms installation; no silent update is claimed.

The slow Windows-hosted emulator is not a phone performance benchmark. Initial OS startup problems and an earlier cache-permission build failure are not counted as passed app checks.

Announcements are in-app Inbox messages, not background push. Saved conversations/selected consented examples do not fine-tune a model. Backend authorization protects prompt editing; model obedience is not a security boundary.

The existing permanent owner key is preserved in .tooling/signing/kitty-owner.jks. Its DPAPI password/private recovery file are excluded from Git/source archives. Back them up privately. Update over previous owner releases to preserve local data. A debug-signed APK requires a separate migration because Android rejects a different certificate; do not uninstall an owner release unnecessarily.
