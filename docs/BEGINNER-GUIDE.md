# KITTY AI beginner guide — v1.7.1

Install [KITTY 1.7.1](https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.7.1.apk) over your existing owner-signed KITTY app. Keep it installed to preserve local history. Version code is **6**; the original signing key is preserved. Google login and the secure browser option use your existing Firebase project.

On the first signed-in launch after upgrading, KITTY asks whether you want meow notifications. Choose **Allow notifications**, then approve Android's permission prompt on Android 13 or later. **Not now** keeps chat working without alerts and does not repeatedly ask. Later, use **Settings → Meow notifications** to allow notifications, mute categories or change their sound in Android settings. The short CC0 kitten sound is included in the APK; it needs no audio download or API key.

Completed replies get one alert; failed/cancelled replies do not. New unread Inbox announcements and trusted newer releases get alerts too. Existing announcements are baselined to avoid replaying old alerts. Notifications hide message content on the lock screen and belong to the signed-in account; switching accounts clears previous alerts and changes the scheduled work.

Inbox/update alerts are actual Android notifications backed by **background checks**, not instant server push. KITTY checks when you open it and schedules connected-network checks about every **15 minutes** when alerts are allowed. Android can delay them for battery saving, offline periods or device restrictions. Force-stopping KITTY prevents checks until it is opened again. Background checks need an active signed-in session; no Firebase Cloud Messaging credential, billing plan or foreground service is required. They use your existing backend's free request/database allowances. Reply alerts require the ongoing reply to finish while KITTY's process is alive; this update does not make interrupted chats continue after process death.

When a saved account is being restored, KITTY shows a branded loading screen rather than a sign-in form. Cached history loads before cloud sync; no deliberate startup delay is added. A genuinely signed-out user still sees Google login.

Open the menu for History, Memory, Inbox and Settings. Send hides the keyboard. The microphone opens your phone’s speech recognition service and places words in the draft; review them before sending. KITTY requests no microphone permission and does not listen in the background. If recognition is not installed, type instead.

Tap the speaker under a completed reply. **Settings → Use device voice** is on by default: Android’s installed text-to-speech engine needs no provider key. Install a voice for your device language in Android’s text-to-speech settings if needed. Turn this setting off to use the admin’s cloud voice. Playback stops on replacement, account change and backgrounding.

The [owner console](https://kitty-ai-v2.kitty-ai.workers.dev) controls providers, core personality, limits, pause, notices and updates. Sign in with your owner Google account. Ordinary users supply no API keys. Chat uses **cloudflare-free → groq-main**. Cloudflare chat and MeloTTS returned real synthetic replies; Groq’s encrypted key is preserved. See [validation](VALIDATION.md) for device and deployment acceptance.

KITTY is created by **Virat with the help of Kitty Corp**. “Made by Kitty Corp” opens https://kittycorp.vercel.app/ on the home and Settings screens.

The following sections document the existing setup. **Do not recreate D1 or replace saved vault/signing keys.**

## 1. What runs where

| Part | Purpose | Account |
|---|---|---|
| Android app | Chat, local history, memories, Inbox, Settings and speech playback | Your phone |
| Firebase Authentication | Google sign-in and verified user identity | `kittyai-f743c` |
| Cloudflare Worker | Secure API, streamed provider calls, owner authorization and encrypted key vault | Your Cloudflare account |
| Cloudflare D1 | Each user’s history, memories, limits and consent | Your Cloudflare account |
| Owner console | Provider setup, personality, limits, notices and updates | Same Worker URL |
| KITTY download site / GitHub Releases | Trusted APK downloads | Existing Worker / `psychspy7/KITTY.AI-v2` |

Firebase Authentication and a small static Firebase Hosting login page are used. No Firestore or Firebase Cloud Functions deployment is needed. Firebase Cloud Functions requires the Blaze billing plan; this project avoids that dependency. Standard Google authentication and Cloudflare Workers/D1 can be used within free allowances. Cloudflare’s free Workers allowance is 100,000 requests/day with a CPU limit; D1 has daily database limits and a storage cap. Exceeding a free allowance can stop service. Do not enable a paid plan unless you choose to pay. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Groq has account/model-specific free limits. Gemini’s current TTS pricing lists a free tier; availability depends on your account, country and quotas. Paid provider plans are optional and need a separate decision. Gemini free-tier processing may be used by Google to improve its products. KITTY’s example-sharing switch controls KITTY’s own review queue; it cannot override an API provider’s terms. Review [Gemini pricing/data treatment](https://ai.google.dev/gemini-api/docs/pricing) and [Groq limits](https://console.groq.com/docs/rate-limits).

## 2. Open the project

Open this folder in Codex or open its `android` subfolder in Android Studio. Use PowerShell from the project root for the commands below. Node.js 22.12+ and Java 17 are required. The supplied Windows tool installer downloads the official Android SDK and Gradle into the ignored `.tooling` folder.

```powershell
npm.cmd ci
./scripts/install-android-tools.ps1
```

The `.tooling` directory, local credentials, keystores and provider secrets must never be uploaded to GitHub.

## 3. Connect Firebase and Cloudflare

```powershell
./scripts/connect-accounts.ps1
```

Sign into Firebase with the Google account that owns KittyAi. Sign into or create your own Cloudflare account and choose **Workers Free**. Complete password, verification and consent steps yourself. You do not need to send passwords or sign-in codes to chat. The script saves CLI sessions in `.tooling/account-config` on your computer.

When you run later commands in a new terminal, use these two settings so the CLIs use the same local sessions:

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.tooling/account-config'
$env:npm_config_cache = Join-Path (Get-Location) '.tooling/npm-cache'
```

## 4. Enable Google login in your existing Firebase project

The supplied Firebase configuration was validated against:

- Project ID: `kittyai-f743c`; project number: `34203306703`.
- Android package: `com.kitty.ai`.
- Android App ID: `1:34203306703:android:1e32ba3a8c58a622d485ba`.
- A Web OAuth client is present in the selected Android config.

The newest matching config from Downloads was copied locally to `android/app/google-services.json`. It is excluded from Git. Firebase app API keys identify the Firebase project and are public app configuration; they are **not** Groq/Gemini provider secrets.

Enable Google authentication using the prepared configuration:

```powershell
npx.cmd -y firebase-tools@latest deploy --only auth --project kittyai-f743c
```

In [Firebase Authentication → Sign-in method](https://console.firebase.google.com/project/kittyai-f743c/authentication/providers), confirm Google is enabled and the support email is correct. If the CLI’s installed version does not support Auth configuration deployment, enable Google on this console page.

Add the APK’s **SHA-1 and SHA-256 signing fingerprints** in Firebase Project settings → Your apps → `com.kitty.ai`. The debug build uses a newly created local debug key. Its fingerprint is recorded in `docs/DEBUG-SIGNING.txt` after the build. A matching JSON file alone does not prove the new key is registered.

Fetch the refreshed Android config programmatically:

```powershell
npx.cmd -y firebase-tools@latest apps:sdkconfig ANDROID 1:34203306703:android:1e32ba3a8c58a622d485ba --project kittyai-f743c --out android/app/google-services.json
node scripts/validate-firebase.mjs
```

For the browser console, register a Firebase Web app called `KITTY Admin`, if one does not already exist:

```powershell
npx.cmd -y firebase-tools@latest apps:list --project kittyai-f743c
npx.cmd -y firebase-tools@latest apps:create WEB 'KITTY Admin' --project kittyai-f743c
```

The admin auth config currently contains the project’s public API key and auth domain, which Firebase Auth can use without an app ID. If you add an app ID, use the newly registered **Web** App ID. Do not use the Android App ID as a Web App ID.

## 5. Create the D1 database and provider vault

```powershell
npx.cmd wrangler d1 create kitty-db --config backend/wrangler.toml
```

Copy the returned `database_id` into the deployment command below. Keep the database on the free plan.

Create a random encryption key locally:

```powershell
node scripts/create-vault-key.mjs
Get-Content backend/.vault-key.local | npx.cmd wrangler secret put VAULT_KEY --config backend/wrangler.toml
```

The vault key is a backend secret, never an Android resource. Preserve it in a secure backup. Losing it makes saved provider keys unreadable; you would need to enter replacement provider keys. Rotating it requires re-encrypting existing keys first.

Set `FIREBASE_WEB_API_KEY` as a Worker secret. Use the **public Firebase project API key** from your validated `google-services.json`; this allows the backend to check account status and revoked sessions. Copy it from that local file into the Wrangler prompt, not into chat:

```powershell
npx.cmd wrangler secret put FIREBASE_WEB_API_KEY --config backend/wrangler.toml
```

If this API key has Android-only application restrictions, use a separate Firebase Web API key restricted to the Firebase Authentication/Identity Toolkit APIs for the Worker. Browser OAuth and backend account lookup must be allowed. Never solve this by embedding a service-account private key in the APK.

## 6. Deploy and activate the owner securely

```powershell
./scripts/deploy-backend.ps1 -DatabaseId 'THE_DATABASE_ID_FROM_CLOUDFLARE'
```

Wrangler prints your actual HTTPS Worker URL. Keep it: both the Android backend and owner console use it. In Firebase Authentication → Settings → Authorized domains, add **only its hostname** (without `https://` or a path). Keep your existing Firebase auth domain authorized.

Open the Worker URL in a browser and sign in as **viratanand1221@gmail.com**. Before activation the page shows your verified Firebase UID and cannot use administrator routes. Copy that UID, then set it locally:

```powershell
npx.cmd wrangler secret put OWNER_UID --config backend/wrangler.toml
```

Enter that exact UID at the terminal prompt. Refresh the console and sign in again if needed. The backend requires all of these: a valid non-revoked Firebase token issued for your project, Google as the sign-in provider, a verified email exactly equal to `viratanand1221@gmail.com`, and a UID exactly equal to `OWNER_UID`. An email match alone does not grant ownership. Ordinary users cannot activate ownership or edit the core prompt.

## 7. Configure KITTY

In **Providers**, use **Edit / test** for an existing provider or choose a type in the new-provider form.

1. Choose an ID, model and API key. Blank preserves a saved key. Cloudflare requires no key.
2. Click **Test request**. Chat must finish a streamed short greeting; speech must return supported audio. Play the speech preview to check the voice.
3. Click **Test & save**. Only a passing test saves the encrypted key/model. Failed tests leave the stored key untouched.
4. Use **Models** to fetch your account’s model list. For ElevenLabs/Fish, copy a voice ID from the provider’s dashboard into the speech form and Routing; this is not your API key.
5. Save **Routing**, then click **Test KITTY’s chat route**. This checks KITTY’s deployed prompt, routing, stream and database path with a temporary synthetic greeting, removed afterward. Tests consume provider quota and are limited to 40 per owner per UTC day.

| Option | Model / voice | Cost boundary |
|---|---|---|
| Cloudflare chat | `@cf/meta/llama-3.1-8b-instruct-fp8` | No key; [10,000 Neurons/day free allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/) shared across users and models. Stops when exhausted. |
| Groq chat | Existing `openai/gpt-oss-120b`; Models/Test can check another text model | Account/model-specific [free rate limits](https://console.groq.com/docs/rate-limits). Speech models cannot serve chat. |
| Device speech | Installed Android voice, default enabled | No cloud provider key; engine/language availability depends on the phone. |
| Cloudflare speech | `@cf/myshell-ai/melotts`, voice/language `en` | Same Cloudflare allowance. Also supports fr/es/zh/ja/ko. |
| Fish Audio speech | Exact **`s2.1-pro-free`**, reference voice ID | [Free model](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits); other models are billed. Unknown spellings are rejected instead of accepting a paid default. |
| ElevenLabs speech | `eleven_multilingual_v2` or tested TTS model, voice ID | Optional [API account credits/eligibility](https://elevenlabs.io/pricing/api). KITTY does not add a subscription or paid plan. |
| Gemini speech | Supported model and a voice such as Kore | Optional account/model quota and billing; check Models/Test and [official speech docs](https://ai.google.dev/gemini-api/docs/speech-generation). |

Cloud speech routing is provider `cloudflare-free`, model `@cf/myshell-ai/melotts`, language `en`. A separate speech-model setting lets the same Cloudflare provider serve chat and speech. The form defaults to a separate `cloudflare-speech` ID when saving a standalone speech entry.

Chat fallback occurs before visible reply text. Partial replies retry with the same request ID to avoid duplicates. Tests display sanitized rate-limit, key/account, model/voice, timeout and empty-answer errors. Saved key values never return. GPT-OSS reasoning can use its budget before visible text, but this was not established as the original phone error’s cause.

In **Personality**, edit the core prompt and creator attribution. In **Limits**, set per-user daily chat/speech allowances, a global daily chat budget and optional per-user overrides. Limits reset at midnight UTC (05:30 India time). Attempts that reach the quota reservation, including provider failures, retries and cancellations, consume allowance. In **Overview**, enable or pause the service.

## 8. Build and install a connected APK

```powershell
./scripts/build-android.ps1 -BackendUrl 'https://YOUR_REAL_WORKER.workers.dev'
```

The result is `artifacts/KITTY-AI-setup-debug.apk`. Copy it to your Android phone (Android 8.0+), open it and allow installation from the app you used to open the file. Sign in with Google. Users enter **no provider key**.

The setup APK delivered before live deployment is installable, but its backend is intentionally marked unconfigured. It clearly reports that setup state. Do not distribute that build as a working service. Rebuilding with the real Worker URL connects it.

Before announcing a public release, test two Google accounts: verify separate history and memories, reply cancellation/retry, account switching, speech stop/play, Inbox read state and an update check. Confirm provider quotas and service pause behavior. The owner console has its own URL; there are no admin controls hidden in the ordinary Android UI.

## 9. Preserve or create your release signing key

The delivered release already has a permanent owner key at `.tooling/signing/kitty-owner.jks`. Keep it. `scripts/build-android.ps1` unlocks its Windows DPAPI password locally, with a private `recovery-password.txt` fallback for another Windows account. Back up the key, recovery password and `android/keystore.properties` privately; the recovery password file contains a secret. These files are excluded from Git and source ZIPs. Public certificate fingerprints are in `OWNER-SIGNING.txt`. Never replace the key after distributing a release. The commands below apply only to a new setup that has no existing key.

If you already have a KITTY release key, preserve and use it. An APK signed with another key cannot update an installed APK with the old signature.

If you have no release key, create one locally using Java’s keytool. It prompts in your terminal; never send its passwords or private key through chat:

```powershell
keytool -genkeypair -v -keystore 'C:/YOUR_PRIVATE_FOLDER/kitty-owner.jks' -alias kitty -keyalg RSA -keysize 3072 -validity 10000
```

Use a folder you control. Back up the keystore and password securely, separately from the source. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill it in only on your computer. That file is ignored by Git. Register the release key’s SHA-1 and SHA-256 with Firebase and fetch the refreshed app config.

```powershell
keytool -list -v -keystore 'C:/YOUR_PRIVATE_FOLDER/kitty-owner.jks' -alias kitty
./scripts/build-android.ps1 -Release -BackendUrl 'https://YOUR_REAL_WORKER.workers.dev' -VersionCode 1 -VersionName '1.0.0'
```

Release builds fail if a real backend URL or owner signing configuration is missing. The debug certificate is not your permanent release certificate. Switching from a debug install to an owner-signed release normally requires uninstalling the debug build. Cloud history remains in your account; any local-only failed message can be lost on uninstall.

## 10. Release future updates

1. Keep the same package name, Firebase project and signing key. Increase versionCode for every published build.
2. Build and test the APK with your owner key. Run `npm run check`, `npm test`, `npm run build`, and the Android build checks.
3. Build the next release with versionCode **7 or higher**, for example `./scripts/build-android.ps1 -Release -BackendUrl 'https://kitty-ai-v2.kitty-ai.workers.dev' -VersionCode 7 -VersionName '1.5.2'`.
4. Copy it to `admin/public/downloads/KITTY-AI-1.5.2.apk`, run `npm run build -w admin`, then `npx wrangler deploy --config backend/wrangler.toml`. Its direct URL is `https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.5.2.apk`. Alternatively create GitHub Release `v1.5.2` in `psychspy7/KITTY.AI-v2`, attach the APK and use its direct release download URL.
5. Run `Get-FileHash artifacts/KITTY-AI-1.5.2.apk -Algorithm SHA256`. In the console's **Updates** page enter versionCode, versionName, direct URL, SHA-256 and notes. Publish an announcement if useful.

Users choose **Settings → Check for updates → Download update**. KITTY downloads into private app storage, shows progress, supports cancellation/retry, accepts only the pinned KITTY APK path or this repository's GitHub release URLs and trusted asset redirects, and checks SHA-256, package, increasing versionCode and exact signing certificate. A verified download survives restart. Tap **Install**. Android may first ask to allow installations from KITTY; return and tap Install again. Android always confirms installation. `REQUEST_INSTALL_PACKAGES` exists solely for this explicit updater; no storage permission or silent installation is used. See [Android installation permission](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()) and [FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider).

Announcements remain in the app's Inbox and can produce optional meow notifications through account sync/background checks. This release requests Android's notification permission and uses WorkManager; it does not use Firebase Cloud Messaging for instant server push.

## 11. Privacy, memory and training

Conversations are stored privately on the device (Android app sandbox, backups disabled) and in D1 under the authenticated user’s UID. Successful messages are synchronized; failed or interrupted local replies are retained on that device and can be retried. Offline chat generation and queued offline memory edits are not supported. Cached history and memories remain readable without a backend connection.

Relevant user memories and up to 17 recent successful messages form bounded model context. Users can add, edit or delete personal memories; backend identity remains controlled by the owner. The app never sends arbitrary client-provided historical system messages to the model.

**Allow example sharing** is off by default. Enabling it does not share all chats: users must additionally choose **Share for review** on individual completed replies. The owner sees only those selected question/answer examples while consent remains active. Turning consent off deletes queue entries. Deleting a conversation removes its shared examples. This release has no training export/job, so no external KITTY training copy is created.

Saving data, selecting examples and actually fine-tuning model weights are different activities. KITTY performs the first two with consent for review; it does not claim model fine-tuning. Groq/Gemini API processing has its own provider data policies.

## Troubleshooting

| Symptom | Check |
|---|---|
| Google login fails / developer error | Enable Google provider, register the current signing SHA fingerprints, refresh `google-services.json`; use a phone with Google Play services |
| Browser popup blocked / unauthorized domain | Allow the sign-in popup and add the Worker hostname to Firebase’s authorized domains |
| Owner access denied | Exact UID, exact verified owner email, Google provider and non-revoked session; no email-only activation |
| Chat service paused | Enable it in Overview after configuring providers |
| No configured provider | Match routing IDs to enabled provider records |
| HTTP 429 | Daily user/global budget or provider free quota; wait for reset or change an admin limit |
| Partial reply / retry conflict | Stop, let the backend finalize (up to 90 seconds; abandoned locks recover after 180 seconds), then retry; completed request IDs are replayed without another provider call |
| Speech unavailable | Use device voice and install the device language voice, or test the admin cloud provider/model/voice. Cloud replies must be complete and under 4,000 characters. |
| Update won’t install | VersionCode must increase and signing key must match the currently installed build |

For production backup, use Cloudflare’s D1 export/recovery tools and securely preserve the Worker vault key. Do not put database exports containing chats in this public repository.
