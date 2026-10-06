# KITTY deployment status — v1.7.0

The [owner console/backend](https://kitty-ai-v2.kitty-ai.workers.dev) is deployed on Cloudflare Workers Free with D1 migrations **0001–0003** and the AI binding. Existing VAULT_KEY, FIREBASE_WEB_API_KEY and exact OWNER_UID secrets are preserved. No new billing/card dependency was added.

Firebase **kittyai-f743c** retains Google Authentication, the original Android registration, signing fingerprints and authorized origins. Exact owner UID: **WCppLHxijDcNqVTxAQkONUrApFm1**, paired with the verified Google email. The secure browser fallback retains https://kittyai-f743c.firebaseapp.com/phone-login.html.

Chat is enabled, using **cloudflare-free → groq-main**. The saved Groq key/model openai/gpt-oss-120b is preserved. The owner confirmed the deployed complete chat-route test passes; D1 recorded Cloudflare live_chat success (537 ms provider duration). Cloud speech is configured to **@cf/myshell-ai/melotts**, language **en**. Android uses free device speech by default. ElevenLabs, Fish Audio and Gemini remain optional and require their own account keys for live validation.

[Download KITTY 1.7.0](https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.7.0.apk): **com.kitty.ai**, versionCode **5**, **3,558,991 bytes**. SHA-256: **17f60be8f3a771f1e84bd10c537c5870e3b9e57f07caed756c2ff44096ceb7db**. Public download returns HTTP 200 / APK MIME and matches the local owner-signed build.

Update metadata is published. Settings → Check for updates downloads and verifies the APK, then opens Android’s installer for user confirmation. Future releases must keep the signing key/package and use versionCode **6 or higher**. Announcements remain in-app Inbox messages without background push.

The console now tests real chat/audio requests before saving a provider, offers audio previews and tests the complete chat route. It retains personality, usage limits, notices, update information and eligible consented examples.

The owner confirmed Google login reached chat in 1.0.3. The owner confirmed a completed reply and keyboard dismissal in v1.5. Remaining speech/account-switch/installer acceptance is recorded in [validation](VALIDATION.md). See the [beginner guide](BEGINNER-GUIDE.md) for operation and releases.
