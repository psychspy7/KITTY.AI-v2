# KITTY deployment status — 5 October 2026

The backend and separate owner console are deployed at **https://kitty-ai-v2.kitty-ai.workers.dev** in the owner's free Cloudflare account. D1 database `kitty-db` is created and migration `0001` applied. The provider encryption key (`VAULT_KEY`) and Firebase account-verification key (`FIREBASE_WEB_API_KEY`) are configured as Worker secrets.

Firebase CLI owner authorization is connected. Google sign-in was enabled and verified through deployment. Both release signing fingerprints are registered, the Worker domain is authorized, and the refreshed Android configuration was downloaded and validated. The owner's exact UID is verified against the Google-linked Firebase user and configured as OWNER_UID. No provider key is configured yet, by the owner's request, and chat remains paused until provider setup.

The release uses package `com.kitty.ai`, versionCode `2`, versionName `1.0.1`, and the actual deployed HTTPS backend. [Download the signed APK](https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.1.apk). Its 3,526,075 bytes match the locally verified build; SHA-256 is `02ba4add9862ef92f04293ea9e4811344f08958c146b115fe3af0ecae231e937`. It installed and launched on Android 15/API 35. See `OWNER-SIGNING.txt` for public certificate fingerprints. The original setup debug APK uses a different signing certificate; uninstall it before installing the owner release. Keep the permanent release key for all subsequent updates.

## Finish Google authorization

Press Windows + R, paste the following and press Enter:

```text
powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "C:\Users\HP\OneDrive\Documents\ChatGPT\KITTY AI\scripts\finish-firebase-signin.ps1"
```

Complete Google login as `viratanand1221@gmail.com`. Keep passwords and any authorization code in the Google page or local terminal. The command's execution-policy setting applies only to that new process.

## Owner activation and provider setup

Open the deployed console and sign in with the owner Google account. This creates the Firebase app-user record; signing into the Firebase developer console alone does not create it. Then run `node scripts/finish-firebase-setup.mjs`. This helper uses the authenticated official Firebase CLI, verifies the exact email, verified status and Google provider, and sets the exact UID as the Worker `OWNER_UID` secret. It preserves existing authorized domains and signing certificates. It does not invent a UID or create an email-only user. Refresh the console, enter a Groq key in Providers, choose the supported model and enable chat. Optional Gemini speech needs its own provider key.

Owner activation was completed with the verified Google-linked UID. Refresh the console to load admin access. Real model calls, phone Google login and a complete future-update installation are not claimed tested. The beginner guide explains provider setup and future APK releases.
