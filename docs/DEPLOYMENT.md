# KITTY deployment status — 2.0.0

Current release: 13 October 2026. See RELEASE-2.0.md for final validation and limits. The entries below are historical; this current entry supersedes their version and paused-payment status.

- Backend / owner console: https://kitty-ai-v2.kitty-ai.workers.dev
- APK: https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-2.0.0.apk
- Package com.kitty.ai; versionCode 11; versionName 2.0.0; Android 8.0+; target API 35.
- Signed APK: 4,495,385 bytes; SHA256 3bc61fa51b7afd6a51d9464d931cda9bccd27c4dd7b12cbd62bd18092e8159cd. Existing owner signing certificate preserved.
- Worker version ce7b6131-4b6c-460c-8d0b-9418a4f8b40f, deployed at 100%. No new operational D1 migration in 2.0.
- Verified public reference library: 500,000,000 UTF8 content bytes, 10,056 packed chunks, Firebase Standard Firestore (default), asia-south1, freeTier true. No billing account linked. Storing references does not fine-tune a model.
- Original Google identity, provider vault, personality, Aiven context, service settings and memberships preserved. KITTY Plus live checkout remains enabled with INR 99/calendar month, 100 chat and 10 cloud speech requests/day, manual renewal. LISA grants and feedback rewards remain disabled.
- Future updates require versionCode 12 or higher and the same signing key/package.

## Historical release and activation log

## KITTY deployment status — 1.8.0

Published 12 October 2026 after the owner requested the app update.

- Backend and owner console: https://kitty-ai-v2.kitty-ai.workers.dev
- APK: https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.8.0.apk
- Package com.kitty.ai; versionCode 10; versionName 1.8.0; minimum API26; target API35.
- APK size 4,479,005 bytes. SHA256: 4b003f225a22a5e3072d380645ff6b58f35bec98d7d9dec4dabe4137bd8f1ba0.
- Signing certificate matches the retained 1.7.1 owner-signed release.
- Code release Worker version bf21cfa0-1e91-4933-af45-9db067a1bde6; current version after private gateway addition:1682e608-00c6-406d-a16d-8f55d0cc47bc (100% deployment).
- D1 migration 0005_memberships.sql applied. Earlier migrations, provider vault, exact Firebase owner identity, creator prompt, enabled-service setting, Aiven context connection and local-history mode preserved.
- Update metadata published and read back: versionCode10, correct URL/checksum. Existing users can use Settings → Check for updates. Background update alerts depend on Android's polling/battery restrictions and notification permission; these are not instant push notifications.
- Free window: five elapsed minutes per UTC day, starting at the first chat request. Daily reset at midnight UTC / 05:30 India.
- Draft KITTY Plus: INR99 per calendar month, 100 chat and 10 cloud-speech requests/day, with existing service caps. Manual renewals.
- Purchases, LISA grants and feedback rewards remain disabled. The private gateway is now configured; hosted website environment and private Razorpay setup/acceptance must be completed before checkout is enabled.

Verification: 72 backend tests; 31 Android unit tests in preview debug/release and stable release, zero failures; debug/release lint; owner console build; Worker dry run; deployed health/access protection tests; public APK download hash/MIME; live membership catalogue purchase/reward gates. No new sensitive Android permissions. A phone was not connected for fresh acceptance testing, and no live payment or provider chat request was made during this release.

Automatic approval review rejected an attempted bridge-credential preparation method because it would print the secret into command output. That command did not execute and no connection secret was disclosed or transferred. That unsafe preparation method was not retried. A safer helper now saves the gateway directly to Cloudflare through standard input and the ignored website environment file, printing only verification results. The live gateway check passed. Hosted Vercel variables still need website-side installation/verification. This did not block the app/backend update.

The website page was published separately by its authorized website task. Its Firebase/customer/payment setup remains separate from the website Studio login and service/donation payments. Read MEMBERSHIPS-SETUP.md before enabling checkout.

Future public APKs must preserve this package/signing key and use versionCode11 or higher.

## Private bridge follow-up — 12 October 2026

Worker COMMERCE_GATEWAY_TOKEN and canonical website .env.local now contain matching private values. Live wrong-token403/valid-token read-only404 checks passed; purchases remain disabled. Firebase Google sign-in authorizes kittycorp.vercel.app and previous domains were preserved. No order, charge or grant was created. Website source was not modified. Hosted Vercel environment, membership Razorpay keys/webhook and paid-access acceptance remain pending. See MEMBERSHIPS-SETUP.md for the exact gates.



## Payment provider follow-up — 12 October 2026
The existing LIVE Razorpay pair is now encrypted in KITTY commerce_settings and verified by private decrypted read-back. The retained local vault backup matches an existing live provider record; no bootstrap route or new Worker deployment was needed. Read-only provider authentication passed. A separate membership webhook remains unconfigured; purchases remain disabled. Website service/donation settings were read privately, not changed. No orders, charges or grants were created. See MEMBERSHIPS-SETUP.md for the private webhook handoff and acceptance gates.

## Separate membership webhook verified — 12 October 2026
The separate merchant endpoint is active with payment.authorized/payment.captured/payment.failed/order.paid/refund.processed. Matching secret is encrypted in KITTY and live Worker gateway decryption was privately verified. All72 backend tests and website isolated membership checks passed again. Checkout/rewards remain disabled; hosted website Google customer acceptance, isolated provider checkout and actual webhook delivery/retry still need verification. No real order/charge/grant or app/code deployment was made.

## Current KITTY Plus activation — 12 October 2026, 16:43 UTC
KITTY Plus LIVE checkout is enabled after the owner purchasing request and verified secure configuration/testing. Live catalogue/provider read-back: INR99 per calendar month,100 chat and10 speech/day, manual renewal; LISA/rewards remain disabled. Hosted invalid signature400 and valid signed non-payment event200/ignored passed; no order, charge or grant created. No APK or Worker code deployment. Actual paid purchase/payment-webhook refund delivery and fresh-phone acceptance are still untested owner steps. This supersedes earlier paused-state entries.
