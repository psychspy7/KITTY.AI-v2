param([string]$BackendUrl='', [switch]$Release, [int]$VersionCode=1, [string]$VersionName='1.0.0')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$env:GRADLE_USER_HOME=Join-Path $taskRoot '.tooling/gradle-cache'
$env:ANDROID_HOME=Join-Path $taskRoot '.tooling/android-sdk'
$env:ANDROID_USER_HOME=Join-Path $taskRoot '.tooling/android-user'
node scripts/validate-firebase.mjs
if ($LASTEXITCODE -ne 0) { throw 'Firebase config validation failed' }
$gradle=Join-Path $taskRoot '.tooling/gradle-8.13/bin/gradle.bat'
if (!(Test-Path $gradle)) { & (Join-Path $PSScriptRoot 'install-android-tools.ps1') }
$taskNames=@('assembleDebug','testDebugUnitTest','lintDebug')
if($Release){
  if (!$BackendUrl.StartsWith('https://') -or $BackendUrl.EndsWith('.invalid')) { throw 'A deployed HTTPS BackendUrl is required.' }
  $taskNames=@('assembleRelease','testReleaseUnitTest','lintRelease')
}
$arguments=@('-p','android','--no-daemon',"-Duser.home=$taskRoot/.tooling/java-user","-PkittyVersionCode=$VersionCode","-PkittyVersionName=$VersionName") + $taskNames
if($BackendUrl){$arguments += "-PkittyBackendUrl=$BackendUrl"}
& $gradle @arguments
if($LASTEXITCODE -ne 0){throw 'Android build or checks failed'}
New-Item -ItemType Directory -Force -Path artifacts | Out-Null
if($Release){Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination "artifacts/KITTY-AI-$VersionName.apk"}else{Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination 'artifacts/KITTY-AI-setup-debug.apk'}

