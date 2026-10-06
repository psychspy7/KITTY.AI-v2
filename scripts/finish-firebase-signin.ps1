$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$env:XDG_CONFIG_HOME = Join-Path $taskRoot '.tooling/account-config'
$env:npm_config_cache = Join-Path $taskRoot '.tooling/npm-cache'
Write-Host 'Sign in with viratanand1221@gmail.com in the browser opened by Firebase.'
Write-Host 'Keep passwords and authorization codes in this window or the Google page, never in chat.'
npx.cmd -y firebase-tools@latest login
if ($LASTEXITCODE -ne 0) { throw 'Firebase sign-in failed. Run this script again to retry.' }
Write-Host 'Firebase is connected. You can return to the KITTY chat.'
