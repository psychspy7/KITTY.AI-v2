$ErrorActionPreference = 'Stop'

# Wait for APK
$apk = "artifacts/KITTY-AI-1.7.0.apk"
while (!(Test-Path $apk)) {
  Start-Sleep -Seconds 5
}
Write-Host "APK found!"

# Copy to downloads
Copy-Item $apk admin/public/downloads/KITTY-AI-1.7.0.apk -Force

# Hash
$hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
Write-Host "APK Hash: $hash"

# Build admin
Push-Location admin
npm install
npm run build
Pop-Location

# Deploy
Push-Location backend
$env:XDG_CONFIG_HOME = "$PWD\..\.tooling\account-config"
$env:WRANGLER_SEND_METRICS = "false"
npx wrangler deploy

# Update settings
$sql = "UPDATE settings SET data = json_set(data, '`$.release.versionCode', 7, '`$.release.versionName', '1.7.0', '`$.release.url', 'https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.7.0.apk', '`$.release.sha256', '$hash', '`$.release.notes', 'KITTY 1.7.0 (Local history and notifications)') WHERE id=1"
npx wrangler d1 execute kitty-db --remote --command="$sql"
Pop-Location

# Git push
node scripts/prepare-repository.mjs
git add .
git commit -m "Release KITTY AI 1.7.0"
git push https://github.com/psychspy7/KITTY.AI-v2.git HEAD:main --force
