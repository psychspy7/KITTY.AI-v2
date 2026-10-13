# Current membership validation

The dated entries below preserve the rollout history. Current state for KITTY 2.0: KITTY Plus LIVE checkout enabled, INR 99/calendar month, 100 chat and 10 cloud-speech requests/day, manual renewal. The live catalogue was read back after the 2.0 deployment and retained these gates. LISA entitlements and feedback rewards are disabled. No real charge or fresh-phone payment acceptance was performed. Read RELEASE-2.0.md and DEPLOYMENT.md first.

## Historical membership validation — 12 October 2026


App/backend implementation is local for review. This task made no production backend deployment, remote D1 migration, live charge or release-manifest update. The separately authorized website task has published its coordinated membership page; website checkout remains disabled.

Verified:
- Backend: 72 tests passed across security, public website gateway and membership suites.
- Backend, owner console and combined website TypeScript checks passed.
- Website membership server regression suite passed against actual server modules with isolated provider/bridge fixtures.
- Existing website Razorpay safeguards passed; combined website production build passed in the website task.
- At localhost:3075/memberships, desktop and 390px mobile plan cards inspected; checkout disabled; Google-account prompt and separate LISA draft visible.
- Feedback link navigated to /contact?subject=Review and selected the Review option.
- Public guide displayed exact feedback invitation; dismissing it removed the invitation while retaining the welcome conversation.
- A faint subtitle and unused third desktop card column were identified and corrected in scoped membership CSS. The rebuilt local preview was subsequently visually checked: scoped subtitle contrast and two-column desktop grid are correct. Screenshots are saved under the canonical outputs/kitty-memberships folder.
- Android debug preview compiled and assembled; 31 unit tests passed with zero failures/errors/skips, and lintDebug passed.
- Owner console production build and Worker deployment dry run passed.
- Merged Android permissions retain the prohibited-permission exclusions.
- Preserved signing key and private password vault are available. No keys/passwords shown.

Security coverage includes immutable server prices, UID/product ownership, authenticated server bridge, callback HMAC, fetched payment amount/currency/capture/refund status, raw signed webhook body, previous webhook secret, test-vs-live separation, cancellation and delayed capture, duplicate delivery, renewal/calendar boundaries, expiry and future grants, and disabled rewards.
Fixtures are not live payment acceptance tests.

Pending:
- Owner-signed release preview is built and verified. Both debug and release executed the same 31 unit tests with zero failures/errors/skips. Both debug and release lint passed. Local build settings use one worker and 1536MB in-process compilation after the interrupted cold build.
- No Android device is connected, so new UI behavior has not been phone-tested.
- Razorpay test checkout/webhook acceptance, merchant approval and private live credentials.
- Website Firebase domain authorization and actual same-account checkout sign-in, after production rollout approval.
- Owner approval of feedback reward proposal.
- Production KITTY D1 migration, backend deployment, signed app publication and trusted update manifest, paused until review approval.

Read docs/MEMBERSHIPS-SETUP.md for management and rollout steps.

## Signed local candidate

artifacts/KITTY-AI-1.8.0-preview.apk: package com.kitty.ai, versionCode 9, versionName 1.8.0-preview, minimum Android API26, target API35. APK signature verified and signing certificate matches the retained KITTY 1.7.1 release. SHA256: 53a7c7659fff41b8c488482b78bdfec481177a9ff92b73446214af780e9a8a34. This is a local review candidate, not a published automatic update. Until the coordinated backend rollout, the existing app remains usable and the new server-controlled membership countdown is inactive.

## Published stable update

The owner authorized publication by requesting the app update. KITTY 1.8.0 (code10) was built, signed with the preserved certificate, passed 31 release unit tests and release lint, and published on 12 October 2026. Public APK MIME/size/hash match the local build. Production migration0005 applied, backend health/protected routes passed, service-enabled setting retained, update metadata verified, and the live catalogue confirms purchases/rewards disabled. See DEPLOYMENT.md for exact current release data and pending payment-bridge configuration.

Private connection follow-up12 October: gateway uploaded through stdin, matching ignored website environment saved; live wrong-token403 and valid-token nonexistent-order404 passed. Catalogue remains closed. Firebase website authorized domain verified, existing domains preserved. Both new helper scripts passed Node syntax checks. Hosted Vercel variables and provider/webhook/paid-access acceptance still unverified; no real charge. An attempted coordination message was rejected by automatic approval review and was not sent.


Provider follow-up: retained vault backup privately verified against a live provider ciphertext; encrypted website runtime read through its existing RPC; Razorpay read-only live-key authentication200. Encrypted KITTY provider saved and privately read back matching; idempotent helper rerun passed. Separate webhook absent and purchase/reward gates remain disabled. No bootstrap route, backend code deployment, charge or APK change. Node syntax check passed. Fresh payment/phone acceptance remains outstanding.


Webhook follow-up: separate merchant webhook active with five expected events; encrypted handoff privately decrypted and sealed into existing KITTY vault. Live authenticated server gateway compared matching key pair/webhook secret and enabled=false without printing them. Backend72/72 passed (39.4s); website isolated membership signature/ownership/refund/webhook tests passed. Merchant registration is verified; actual provider webhook delivery, hosted Google login and fresh phone/live capture acceptance remain untested. No actual charge or production grant.


Current activation16:43 UTC: hosted bad webhook signature400/valid signed non-payment readiness200 ignored. Owner-requested KITTY-only LIVE switches activated; verified catalogue/provider report enabled,INR9900 minor units/calendar month,100chat/10speech daily, manual renewal. LISA/rewards disabled. No real payment or phone test performed. No APK/backend code deployment. Existing72 backend and website fixture checks were the isolated payment logic evidence, not a completed real purchase.
