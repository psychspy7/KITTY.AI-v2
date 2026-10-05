# Delivered artifacts

- `artifacts/KITTY-AI-1.0.1.apk`: permanent owner-signed release for Android 8.0+, connected to the deployed HTTPS backend, with the in-app downloader/installer handoff. [Phone download](https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.1.apk).
- `artifacts/KITTY-AI-source.zip`: complete source archive, including validated public Android Firebase configuration and original icon master. Provider secrets, CLI sessions, caches and private signing keys are excluded.

APK bytes: 3526075

APK SHA-256: `02ba4add9862ef92f04293ea9e4811344f08958c146b115fe3af0ecae231e937`

See [validation](VALIDATION.md), [setup and release instructions](BEGINNER-GUIDE.md), [deployment status](DEPLOYMENT.md), and [owner signing fingerprints](OWNER-SIGNING.txt). The older setup debug APK is retained locally as a historical artifact and uses another signing certificate. Owner activation and provider setup status are documented separately from the APK's successful build/install checks.
