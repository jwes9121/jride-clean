param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [string]$OutDir = "$env:USERPROFILE\Desktop"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$p) {
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function Copy-IfExists([string]$src, [string]$dst) {
  if (Test-Path -LiteralPath $src) {
    Ensure-Dir (Split-Path $dst -Parent)
    Copy-Item -LiteralPath $src -Destination $dst -Force
    return $true
  }
  return $false
}

Write-Host "== ZIP JRIDE DISPATCH ACCEPT DIAG FILES (V1 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path $ProjRoot).Path
if (!(Test-Path -LiteralPath $root)) { throw "ProjRoot not found: $ProjRoot" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$stage = Join-Path $OutDir ("JRIDE_UPLOAD_DISPATCH_ACCEPT_V1_" + $ts)
Ensure-Dir $stage

$manifest = New-Object System.Collections.Generic.List[string]
$missing  = New-Object System.Collections.Generic.List[string]

# ---- Web files (Next.js) ----
$webTargets = @(
  "app\api\dispatch\status\route.ts",
  "app\api\driver\location\ping\route.ts",
  "app\api\driver\active-trip\route.ts",
  "utils\supabase\server.ts",
  "auth.ts"
)

foreach ($rel in $webTargets) {
  $src = Join-Path $root $rel
  $dst = Join-Path $stage ("web\" + $rel)
  if (Copy-IfExists $src $dst) {
    $manifest.Add("OK  web\$rel")
  } else {
    $missing.Add("MISS web\$rel")
  }
}

# ---- Android files (optional; if you point ProjRoot to Android repo, it will pick these up) ----
$androidTargets = @(
  "app\src\main\java\com\jride\app\LiveLocationClient.kt",
  "app\build.gradle",
  "app\build.gradle.kts",
  "build.gradle",
  "build.gradle.kts"
)

foreach ($rel in $androidTargets) {
  $src = Join-Path $root $rel
  $dst = Join-Path $stage ("android\" + $rel)
  if (Copy-IfExists $src $dst) {
    $manifest.Add("OK  android\$rel")
  }
}

# Add a quick tree listing (helps locate)
try {
  $treePath = Join-Path $stage "_tree.txt"
  cmd /c "cd /d `"$stage`" && tree /F /A > `"_tree.txt`"" | Out-Null
} catch { }

# Write manifest
$mfPath = Join-Path $stage "_MANIFEST.txt"
$manifest | Set-Content -LiteralPath $mfPath -Encoding UTF8
if ($missing.Count -gt 0) {
  Add-Content -LiteralPath $mfPath -Value ""
  Add-Content -LiteralPath $mfPath -Value "---- MISSING (not found under ProjRoot) ----"
  $missing | Add-Content -LiteralPath $mfPath
}

# Zip it
$zipPath = Join-Path $OutDir ("JRIDE_UPLOAD_DISPATCH_ACCEPT_V1_" + $ts + ".zip")
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "[OK] Staged folder:" -ForegroundColor Green
Write-Host "     $stage"
Write-Host "[OK] ZIP created:" -ForegroundColor Green
Write-Host "     $zipPath"
Write-Host ""
Write-Host "Upload this ZIP: $zipPath" -ForegroundColor Yellow