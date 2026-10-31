<#
  Creates the upload keystore Google Play asks for, and the local signing config.

  Run it yourself in PowerShell (it asks for the passwords, so they never pass through anyone else):
      pwsh scripts/android-keystore.ps1

  It makes:
    ~/nexus-keys/nexus-upload.jks            the keystore (OUTSIDE the repo)
    apps/app/android/keystore.properties     read by app/build.gradle (git-ignored)
  and copies the base64 form of the keystore to your clipboard for the ANDROID_KEYSTORE_BASE64
  GitHub secret. Nothing secret is printed.

  BACK UP the .jks file and both passwords somewhere safe (a password manager). With Play App Signing
  a lost upload key can be reset by Google, but it takes support time.
#>
$ErrorActionPreference = 'Stop'

if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
  throw 'keytool was not found. Install a JDK (Temurin 21) and make sure its bin folder is on PATH.'
}

$dir = Join-Path $HOME 'nexus-keys'
$jks = Join-Path $dir 'nexus-upload.jks'
$props = Join-Path (Split-Path $PSScriptRoot -Parent) 'apps/app/android/keystore.properties'
$alias = 'upload'

if (Test-Path $jks) { throw "$jks already exists. Move it away first, or delete it if you are sure: re-running would not replace it." }
New-Item -ItemType Directory -Force $dir | Out-Null

Write-Host "keytool will now ask for a keystore password and your details. Remember the password."
keytool -genkeypair -v -keystore $jks -alias $alias -keyalg RSA -keysize 2048 -validity 10000
if ($LASTEXITCODE -ne 0) { throw 'keytool failed.' }

function Read-Plain($prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
Write-Host 'Enter the same passwords again so the build can sign (kept only in the git-ignored file).'
$storePass = Read-Plain 'Keystore password'
$keyPass = Read-Plain 'Key password (press Enter if keytool said it is the same as the keystore password)'
if (-not $keyPass) { $keyPass = $storePass }

# Check they work before writing anything.
keytool -list -keystore $jks -storepass $storePass -alias $alias | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'That keystore password does not open the keystore.' }

@(
  "storeFile=$($jks -replace '\\','/')",
  "storePassword=$storePass",
  "keyAlias=$alias",
  "keyPassword=$keyPass"
) | Set-Content -Encoding ascii $props

[Convert]::ToBase64String([IO.File]::ReadAllBytes($jks)) | Set-Clipboard

Write-Host ''
Write-Host "Keystore:  $jks"
Write-Host "Signing config written to: $props (git-ignored)"
Write-Host 'The base64 keystore is on your clipboard. In GitHub: Settings > Secrets and variables > Actions, add'
Write-Host '  ANDROID_KEYSTORE_BASE64   (paste)'
Write-Host '  ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS (= upload), ANDROID_KEY_PASSWORD'
Write-Host 'Then back the .jks and the passwords up.'
