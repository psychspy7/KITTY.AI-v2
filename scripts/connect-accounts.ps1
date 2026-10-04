$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$env:npm_config_cache=Join-Path $taskRoot '.tooling/npm-cache'
$env:XDG_CONFIG_HOME=Join-Path $taskRoot '.tooling/account-config'
npx.cmd -y firebase-tools@latest login
if($LASTEXITCODE -ne 0){throw 'Firebase sign-in failed'}
npx.cmd wrangler login
if($LASTEXITCODE -ne 0){throw 'Cloudflare sign-in failed'}
Write-Output 'Account sessions are saved locally under .tooling/account-config. Never share that folder.'
