# BUILD-JRIDE_DRIVER_RELEASE_DIST.ps1
# Builds Android Release AAB + APK and copies them to C:\JRIDE_BUILDS\ with timestamped names.
# FAILS FAST if signing config is missing.
# ASCII-only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$proj = "C:\Users\jwes9\AndroidStudioProjects\JRideApp"
if (!(Test-Path $proj)) { Fail "Project not found: $proj" }

$gradlew = Join-Path $proj "gradlew.bat"
if (!(Test-Path $gradlew)) { Fail "gradlew.bat not found in: $proj" }

$appGradle = Join-Path $proj "app\build.gradle"
$appGradleKts = Join-Path $proj "app\build.gradle.kts"
if (!(Test-Path $appGradle) -and !(Test-Path $appGradleKts)) {
  Fail "Could not find app build.gradle or build.gradle.kts under $proj\app"
}

$buildFile = $null
if (Test-Path $appGradle) { $buildFile = $appGradle }
elseif (Test-Path $appGradleKts) { $buildFile = $appGradleKts }
else { Fail "Unexpected: build file not found." }

# Basic signing config presence check (fail fast)
$buildTxt = Get-Content $buildFile -Raw -Encoding utf8

$hasSigning = $false
if (($buildTxt -match "signingConfigs") -and ($buildTxt -match "release") -and ($buildTxt -match "signingConfig")) {
  $hasSigning = $true
}

if (-not $hasSigning) {
  Fail @"
Signing is not configured in:
  $buildFile

For MANY drivers, you should use Google Play Internal Testing.
If you still want a signed APK/AAB, we must add signingConfigs + release signingConfig.
Upload or paste your $buildFile and I will generate a safe anchor-based patch script.
"@
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = "C:\JRIDE_BUILDS"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Push-Location $proj
try {
  Write-Host "[INFO] Gradle version:"
  & $gradlew --version

  Write-Host "[INFO] Cleaning..."
  & $gradlew clean

  Write-Host "[INFO] Building Release AAB (for Play Console)..."
  & $gradlew :app:bundleRelease

  Write-Host "[INFO] Building Release APK (fallback sideload)..."
  & $gradlew :app:assembleRelease
}
finally {
  Pop-Location
}

# Locate outputs
$aabRoot = Join-Path $proj "app\build\outputs\bundle"
$apkRoot = Join-Path $proj "app\build\outputs\apk"

$aab = Get-ChildItem -Path $aabRoot -Recurse -File -Filter "*.aab" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

$apk = Get-ChildItem -Path $apkRoot -Recurse -File -Filter "*release*.apk" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $aab) { Fail "AAB not found under app\build\outputs\bundle (bundleRelease may have failed)." }
if (-not $apk) { Fail "Release APK not found under app\build\outputs\apk (assembleRelease may have failed)." }

# Copy to easy distribution folder
$aabOut = Join-Path $outDir ("JRIDE_DRIVER_release_" + $stamp + ".aab")
$apkOut = Join-Path $outDir ("JRIDE_DRIVER_release_" + $stamp + ".apk")

Copy-Item $aab.FullName $aabOut -Force
Copy-Item $apk.FullName $apkOut -Force

Write-Host "[OK] AAB: $aabOut"
Write-Host "[OK] APK: $apkOut"

# Hashes for integrity when sharing
$h1 = (Get-FileHash $aabOut -Algorithm SHA256).Hash
$h2 = (Get-FileHash $apkOut -Algorithm SHA256).Hash
Write-Host "[OK] SHA256(AAB): $h1"
Write-Host "[OK] SHA256(APK): $h2"

Write-Host ""
Write-Host "NEXT:"
Write-Host "1) Upload the .aab to Google Play Console -> Internal testing (recommended)."
Write-Host "2) If sideloading, upload the .apk to Drive and share the link."
