$ErrorActionPreference = 'Stop'

# 1. Build Android Release APK
Write-Host "Building Android APK 1.7.1..."
.\scripts\build-android.ps1 -Release -BackendUrl "https://kitty-ai-v2.kitty-ai.workers.dev" -VersionCode 8 -VersionName "1.7.1"
if ($LASTEXITCODE -ne 0) { throw "Android build failed" }

# Wait for APK (should be copied to artifacts/KITTY-AI-1.7.1.apk by the build script)
$apk = "artifacts/KITTY-AI-1.7.1.apk"
while (!(Test-Path $apk)) {
  Start-Sleep -Seconds 5
}
Write-Host "APK found!"

# Copy to downloads
Copy-Item $apk admin/public/downloads/KITTY-AI-1.7.1.apk -Force

# Hash
$hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
Write-Host "APK Hash: $hash"

# Build admin
Push-Location admin
npm run build
Pop-Location

# Deploy
Push-Location backend
$env:XDG_CONFIG_HOME = "$PWD\..\.tooling\account-config"
$env:WRANGLER_SEND_METRICS = "false"
npx wrangler deploy

# Update settings
$sql = "UPDATE settings SET data = json_set(data, '`$.release.versionCode', 8, '`$.release.versionName', '1.7.1', '`$.release.url', 'https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.7.1.apk', '`$.release.sha256', '$hash', '`$.release.notes', 'KITTY 1.7.1 (New sound & granular notification settings)') WHERE id=1"
npx wrangler d1 execute kitty-db --remote --command="$sql"
Pop-Location

# Update documentation
(Get-Content README.md) -replace '1\.7\.0', '1.7.1' | Set-Content README.md
(Get-Content docs/BEGINNER-GUIDE.md) -replace '1\.7\.0', '1.7.1' | Set-Content docs/BEGINNER-GUIDE.md
(Get-Content docs/DEPLOYMENT.md) -replace '1\.7\.0', '1.7.1' | Set-Content docs/DEPLOYMENT.md
(Get-Content docs/VALIDATION-1.7.md) -replace '1\.7\.0', '1.7.1' -replace 'versionCode 7', 'versionCode 8' | Set-Content docs/VALIDATION-1.7.md

# Git push
node scripts/prepare-repository.mjs
git add .
git commit -m "Release KITTY AI 1.7.1"
git push https://github.com/psychspy7/KITTY.AI-v2.git HEAD:main --force
