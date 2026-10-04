param([Parameter(Mandatory=$true)][string]$DatabaseId)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$env:npm_config_cache=Join-Path $taskRoot '.tooling/npm-cache'
$env:XDG_CONFIG_HOME=Join-Path $taskRoot '.tooling/account-config'
$env:WRANGLER_SEND_METRICS='false'
if($DatabaseId -notmatch '^[0-9a-fA-F-]{36}$'){throw 'Use the real database_id returned by wrangler d1 create kitty-db'}
$configPath=Join-Path $taskRoot 'backend/wrangler.toml'
$text=Get-Content -LiteralPath $configPath -Raw
$text=$text -replace 'database_id = "[^"]+"',"database_id = `"$DatabaseId`""
Set-Content -LiteralPath $configPath -Value $text -Encoding utf8
node scripts/validate-firebase.mjs
npm.cmd run build -w admin
if($LASTEXITCODE -ne 0){throw 'Admin build failed'}
npx.cmd wrangler d1 migrations apply kitty-db --remote --config backend/wrangler.toml
if($LASTEXITCODE -ne 0){throw 'Migration failed'}
npx.cmd wrangler deploy --config backend/wrangler.toml
if($LASTEXITCODE -ne 0){throw 'Deployment failed'}
