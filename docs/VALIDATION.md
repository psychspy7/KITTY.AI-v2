# KITTY AI v1.5 validation report

Validation: **5 October 2026 (UTC)**. Release **1.5.0 / versionCode 5**.

## What changed and what is established

The phone reported Groq requests failing with “Reply interrupted” and no visible answer. Recent request metadata confirmed failed replies with zero response text. The saved Groq key completed a synthetic request through an isolated local instance of KITTY’s backend using the real API; this did not establish the original production failure’s cause.

Streaming now parses complete SSE frames, emits keepalive events, distinguishes empty/truncated replies, preserves safe provider errors and stops the Android reader immediately at KITTY’s done event. Fallback occurs before visible text. The owner console now tests a real short chat/audio request before saving and can test the full deployed chat/database route; failed tests do not overwrite keys.

A rollout error was found and corrected: the settings validator initially rejected Cloudflare speech’s @cf/ prefix. It blocked the console and chat before inference. A regression now loads those speech settings and completes chat. **The owner subsequently confirmed the deployed chat-route test passes**, with D1 recording Cloudflare success in 537 ms of provider time. This explains the rollout’s Invalid input failure; it does not retrospectively prove the original Groq error’s cause.

Cloudflare free chat is primary, with Groq retained as fallback. Real Cloudflare inference returned completed SSE replies and WAV speech (149,862 and 150,886-byte synthetic samples) using the saved KITTY configuration. These provider probes used synthetic identities locally, without reading user conversations.

The Android UI uses a compact header/menu and charcoal chat layout. Send dismisses the keyboard. Home and Settings link “Made by Kitty Corp” to the supplied site. Android device speech is the default; optional cloud speech handles WAV/MP3 for Cloudflare, Gemini, ElevenLabs and Fish Audio. Dictation delegates to the phone’s foreground recognition service.

## Final verified checks

| Check | Result |
|---|---|
| Backend / admin TypeScript | Pass. |
| Backend regressions | **45 pass** with real Miniflare D1 and simulated identities/provider responses; JWT tests use generated signed tokens. |
| New backend coverage | Pre-save testing, exact-owner protection, encrypted replacement keys, failed-key preservation, no upstream secret echo, complete route cleanup, rate-limit metadata, multiline UTF-8 SSE, reasoning-only empty output, ElevenLabs/Fish request formats, exact Fish free-model spelling, Cloudflare speech configuration. |
| Production | Worker/console/API/D1/AI deployed; full route owner-confirmed pass with recorded live Cloudflare success. |
| Provider live probes | Saved Groq completed a synthetic local-backend request with the real API. Cloudflare chat and speech real API probes passed. |
| Android release | assembleRelease, testReleaseUnitTest and lintRelease pass after correcting compilation/formatting findings. Java 17 / Gradle 8.13 / AGP 8.13.2 / Kotlin 2.3.20; API 26 minimum, target 35. |
| Android unit tests | **17 pass**, zero failures/errors/skips. Includes history merge, login proof, update URLs/checksums/package/version/certificates and SSE boundaries/heartbeats/size limits. |
| Lint | **0 errors, 24 warnings** retained for SDK/dependency currency, resources/style suggestions. |
| Signature | apksigner verifies the existing owner certificate: **047129a730f0686d4f83f1d89d690811f5d7f91e09cd283cb9fdfff0a14661d1**. |
| APK | com.kitty.ai / code 5 / 1.5.0, **3,558,991 bytes**. |
| Public download | HTTP 200, APK MIME, exact SHA-256 **17f60be8f3a771f1e84bd10c537c5870e3b9e57f07caed756c2ff44096ceb7db**. |
| Permissions | INTERNET, explicit-update REQUEST_INSTALL_PACKAGES, network state, Google READ_GSERVICES and app-specific receiver permission. No microphone, phone-control, accessibility, contacts, SMS, call-log or broad storage permission. |
| Manifest / test separation | TTS service discovery declared. The debug-only UiPreviewActivity and fixture audio are absent from the owner release. |
| Release emulator | Signed APK successfully updates the previous owner release on Android 15/API 35 and cold-launches; login screenshot/XML captured. No KITTY crash recorded at this check. |
| Debug UI/audio fixture | Same composer dismisses the keyboard: mInputShown true before Send, false afterward. Device voice and a real Cloudflare WAV each reach playback completion on Android 15; Stop returns Audio stopped. This headless emulator has audio output disabled; listening quality is not established. |
| Phone v1.5 | Owner confirmed completed reply and keyboard dismissal. |
| Update publication | v1.5 metadata/checksum published after download verification. |

## Device acceptance and limits

**The owner reports that v1.5 finishes a chat reply and closes the keyboard after sending.** This is phone acceptance reported in chat, without an instrumented phone trace. Google login reaching chat in 1.0.3 and the v1.5 deployed route passing are also user-reported. Speech, two-account switching and the full download → permission → installer flow still need phone acceptance. A successful ADB update verifies package/signature compatibility, not the full in-app installer flow.

Emulator UI/audio fixtures are separate debug code, with synthetic display data and no Firebase sign-in/backend chat. They exercise the same chat composer/layout and playback classes. Fixture results do not establish authenticated phone chat. Evidence includes release login and debug chat/audio screenshots/XML under docs/evidence. An unrelated Digital Wellbeing system ANR was dismissed during the run; it was not a KITTY ANR.

ElevenLabs/Fish API contract tests simulate provider audio responses; no live keys were supplied and no live voice-quality/credit test is claimed. Gemini speech remains contract-tested only. Device speech depends on an installed Android engine/language voice. Cloudflare’s free chat/speech budget is shared and finite. The Windows emulator is not a phone performance benchmark.

Core editing is protected by backend identity checks; model prompt obedience is not an authorization boundary. History/memories remain per user. Examples require opt-in consent and individual sharing; saved chats do not fine-tune a model. Announcements are in-app, without background push. Android confirms APK installation; silent updating is not claimed.

The permanent owner key, local vault key, CLI sessions and passwords remain private and excluded from Git/source archives. Preserve the signing and vault keys when releasing future updates.
