$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $taskRoot '.tooling'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
New-Item -ItemType Directory -Force -Path $toolsRoot, $sdkRoot | Out-Null
$sdkZip = Join-Path $toolsRoot 'android-tools.zip'
if (!(Test-Path (Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
  node (Join-Path $PSScriptRoot 'download.mjs') 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' $sdkZip
  if ($LASTEXITCODE -ne 0) { throw 'SDK tools download failed' }
  Expand-Archive -LiteralPath $sdkZip -DestinationPath (Join-Path $toolsRoot 'android-unpack') -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'cmdline-tools') | Out-Null
  Move-Item -LiteralPath (Join-Path $toolsRoot 'android-unpack\cmdline-tools') -Destination (Join-Path $sdkRoot 'cmdline-tools\latest')
}
$gradleRoot = Join-Path $toolsRoot 'gradle-8.13'
if (!(Test-Path $gradleRoot)) {
  $gradleZip = Join-Path $toolsRoot 'gradle.zip'
  node (Join-Path $PSScriptRoot 'download.mjs') 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' $gradleZip
  node (Join-Path $PSScriptRoot 'download.mjs') 'https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256' (Join-Path $toolsRoot 'gradle.sha256')
  $expected = (Get-Content -LiteralPath (Join-Path $toolsRoot 'gradle.sha256') -Raw).Trim()
  if ((Get-FileHash -LiteralPath $gradleZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Gradle checksum failed' }
  Expand-Archive -LiteralPath $gradleZip -DestinationPath $toolsRoot -Force
}
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache'
1..100 | ForEach-Object { 'y' } | & (Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat') --sdk_root=$sdkRoot --licenses
& (Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat') --sdk_root=$sdkRoot 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed' }
$escaped = $sdkRoot.Replace('\','/').Replace(':','\:')
Set-Content -LiteralPath (Join-Path $taskRoot 'android\local.properties') -Value "sdk.dir=$escaped" -Encoding ascii
Write-Output 'Android build tools ready in .tooling'

