param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Write-Host "== PATCH JRIDE ANDROID: add driver secret header on POST + set versionCode 500000043 (V1 / PS5-safe) ==" -ForegroundColor Cyan

function Ensure-Dir([string]$p) { if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }

$root = (Resolve-Path $ProjRoot).Path

# ----------------------------
# 1) Patch LiveLocationClient.kt
# ----------------------------
$kt = Join-Path $root "app\src\main\java\com\jride\app\LiveLocationClient.kt"
if (!(Test-Path -LiteralPath $kt)) { throw "Missing: $kt" }

$bakDir = Join-Path $root "_patch_bak"
Ensure-Dir $bakDir
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakKt = Join-Path $bakDir ("LiveLocationClient.kt.bak.ACCEPT_SECRET_HDR_V1.$ts")
Copy-Item -LiteralPath $kt -Destination $bakKt -Force
Write-Host "[OK] Backup: $bakKt"

$txt = Get-Content -LiteralPath $kt -Raw

if ($txt -match "POSTJSON_DRIVER_SECRET_HEADER_V1") {
  Write-Host "[OK] LiveLocationClient.kt already has POSTJSON_DRIVER_SECRET_HEADER_V1. Skipping Kotlin patch."
} else {
  # Anchor inside postJsonAsync(): find "val req =" line that builds the Request, regardless of whitespace/newlines.
  # We will replace ONLY the first matching occurrence.
  $pattern = '(?s)val\s+req\s*=\s*Request\.Builder\(\)\s*\.url\(\s*url\s*\)\s*\.post\(\s*body\s*\)\s*\.build\(\s*\)'

  $m = [regex]::Match($txt, $pattern)
  if (!$m.Success) {
    throw "Could not locate Request.Builder().url(url).post(body).build() inside LiveLocationClient.kt (whitespace-tolerant)."
  }

  $replacement = @'
val b = Request.Builder().url(url).post(body)

// POSTJSON_DRIVER_SECRET_HEADER_V1
try {
    val secret = try { (com.jride.app.BuildConfig.DRIVER_PING_SECRET ?: "").trim() } catch (_: Exception) { "" }
    if (secret.isNotEmpty()) b.addHeader("x-driver-ping-secret", secret)
} catch (_: Exception) { }

val req = b.build()
'@

  $txt2 = [regex]::Replace($txt, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $replacement }, 1)
  Set-Content -LiteralPath $kt -Value $txt2 -Encoding UTF8
  Write-Host "[OK] Patched header injection in LiveLocationClient.kt"
}

# ----------------------------
# 2) Force versionCode = 500000043
# ----------------------------
$gradleGroovy = Join-Path $root "app\build.gradle"
$gradleKts    = Join-Path $root "app\build.gradle.kts"

$gradleFile = $null
$isKts = $false

if (Test-Path -LiteralPath $gradleGroovy) { $gradleFile = $gradleGroovy; $isKts = $false }
elseif (Test-Path -LiteralPath $gradleKts) { $gradleFile = $gradleKts; $isKts = $true }
else { throw "Missing app build file: app\build.gradle or app\build.gradle.kts" }

$bakGradle = Join-Path $bakDir ((Split-Path $gradleFile -Leaf) + ".bak.SET_VC500000043_V1.$ts")
Copy-Item -LiteralPath $gradleFile -Destination $bakGradle -Force
Write-Host "[OK] Backup: $bakGradle"

$g = Get-Content -LiteralPath $gradleFile -Raw

# Replace versionCode line (Groovy: versionCode 123) or (KTS: versionCode = 123)
$vcPattern = '(?m)^\s*versionCode\s*(=)?\s*\d+\s*$'
if ($g -notmatch $vcPattern) {
  throw "Could not find versionCode line in: $gradleFile"
}
$g2 = [regex]::Replace($g, $vcPattern, { param($mm)
  if ($isKts) { "        versionCode = 500000043" } else { "        versionCode 500000043" }
}, 1, [System.Text.RegularExpressions.RegexOptions]::Multiline)

# Best-effort: if versionName exists, append/update to include ".43" at end (non-breaking).
# (If it can't match cleanly, we leave versionName unchanged.)
$vnPattern = '(?m)^\s*versionName\s*(=)?\s*["'']([^"'']+)["'']\s*$'
if ($g2 -match $vnPattern) {
  $g2 = [regex]::Replace($g2, $vnPattern, { param($mm)
    $isEq = $mm.Groups[1].Value
    $cur  = $mm.Groups[2].Value
    $next = $cur
    if ($cur -match '\.\d+$') { $next = ($cur -replace '\.\d+$', '.43') }
    else { $next = $cur + ".43" }
    if ($isKts) { "        versionName = `"$next`"" } else { "        versionName `"$next`"" }
  }, 1, [System.Text.RegularExpressions.RegexOptions]::Multiline)
}

Set-Content -LiteralPath $gradleFile -Value $g2 -Encoding UTF8
Write-Host "[OK] Set versionCode=500000043 in $(Split-Path $gradleFile -Leaf)"

Write-Host ""
Write-Host "[NEXT] Build signed release APK:" -ForegroundColor Yellow
Write-Host "  cd `"$root`""
Write-Host "  .\gradlew clean assembleRelease"
Write-Host ""
Write-Host "[APK PATH] Typically:" -ForegroundColor Yellow
Write-Host "  $root\app\build\outputs\apk\release\app-release.apk"
Write-Host ""
Write-Host "Done."