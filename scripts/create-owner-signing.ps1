$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$properties = Join-Path $taskRoot 'android/keystore.properties'
$signingFolder = Join-Path $taskRoot '.tooling/signing'
$keyFile = Join-Path $signingFolder 'kitty-owner.jks'
$passwordFile = Join-Path $signingFolder 'password.dpapi'
if (Test-Path -LiteralPath $properties) { Write-Host 'Existing signing configuration preserved.'; exit 0 }
if ((Test-Path -LiteralPath $keyFile) -or (Test-Path -LiteralPath $passwordFile)) { throw 'Signing files already exist. Restore their configuration; never overwrite the key.' }
New-Item -ItemType Directory -Force -Path $signingFolder | Out-Null
$randomBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($randomBytes)
$random.Dispose()
$signingPassword = [Convert]::ToBase64String($randomBytes)
$securePassword = ConvertTo-SecureString -String $signingPassword -AsPlainText -Force
try {
    $env:KITTY_RELEASE_STORE_PASSWORD = $signingPassword
    $env:KITTY_RELEASE_KEY_PASSWORD = $signingPassword
    keytool -genkeypair -keystore $keyFile -storetype JKS -alias kitty -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Virat, OU=KITTY AI, O=Kitty Corp' -storepass:env KITTY_RELEASE_STORE_PASSWORD -keypass:env KITTY_RELEASE_KEY_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
    ConvertFrom-SecureString -SecureString $securePassword | Set-Content -LiteralPath $passwordFile -Encoding ascii
    $signingPassword | Set-Content -LiteralPath (Join-Path $signingFolder 'recovery-password.txt') -Encoding ascii
    "storeFile=$($keyFile.Replace('\','/'))`nkeyAlias=kitty" | Set-Content -LiteralPath $properties -Encoding ascii
    Write-Host 'Permanent KITTY owner key created. Password protected with Windows DPAPI for this Windows account.'
    Write-Host 'Keep .tooling/signing and android/keystore.properties backed up privately; recovery-password.txt is private and enables recovery on another Windows account.'
} finally {
    Remove-Item Env:KITTY_RELEASE_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:KITTY_RELEASE_KEY_PASSWORD -ErrorAction SilentlyContinue
    $signingPassword = $null
    $securePassword.Dispose()
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}
