# KITTY deployment status — 5 October 2026

Backend/owner console: **https://kitty-ai-v2.kitty-ai.workers.dev**. D1 kitty-db has migrations **0001/0002**. Worker secrets VAULT_KEY, FIREBASE_WEB_API_KEY and exact OWNER_UID are configured. The AI binding provides a free fallback. No billing plan/payment-card dependency was added.

Firebase project **kittyai-f743c** retains the original Android registration. Google Authentication, release/debug certificates and authorized domains are configured. Owner UID is **WCppLHxijDcNqVTxAQkONUrApFm1**. Browser login uses the static first-party page https://kittyai-f743c.firebaseapp.com/phone-login.html, opened with a short-lived session by the app. Only its exact origin is allowed for the completion endpoint; owner APIs remain restricted.

Chat is **enabled**, routing **groq-main → cloudflare-free**. Groq uses the existing encrypted key and **openai/gpt-oss-120b**; the incorrectly selected Orpheus speech model was replaced. Both providers returned finished live synthetic streams. Optional Gemini speech still needs a Gemini key. Users supply no keys.

[Download KITTY 1.0.3](https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk): com.kitty.ai, code **4**, **3,542,551 bytes**. SHA-256: f7873810db3140734e8e92b87e2e8ae0b72945a71eb21cd30baeb36a174864fb. Public bytes match the signed local build. Update over previous owner releases; keep the same signing key.

The console controls keys/models/fallbacks, personality/creator, pause/limits, announcements, updates and eligible consented examples. Sign in with the owner Google account. Backend authorization requires its exact UID and verified email.

Settings → Check for updates uses published 1.0.3 metadata/checksum. Future releases can use the pinned KITTY APK path or configured GitHub Releases, preserving signing key and increasing versionCode. Android confirms installation. Notices are in-app, without background push.

For browser-page changes: npm run build -w admin, node scripts/prepare-auth-hosting.mjs, then firebase deploy --only hosting --project kittyai-f743c. Deploy the Worker separately with npm run build -w admin and npx wrangler deploy --config backend/wrangler.toml. Do not recreate the database or replace existing vault/signing keys.

The owner confirmed Android Google sign-in reaches chat in 1.0.3. A completed Android chat reply and the complete updater installer flow still need acceptance. See [validation](VALIDATION.md) and [beginner guide](BEGINNER-GUIDE.md).
