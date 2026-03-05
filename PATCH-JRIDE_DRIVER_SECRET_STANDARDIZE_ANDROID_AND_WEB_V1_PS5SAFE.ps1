param(
  [Parameter(Mandatory=$true)][string]$AndroidRoot,
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup-File([string]$root, [string]$rel, [string]$tag) {
  $src = Join-Path $root $rel
  if (!(Test-Path -LiteralPath $src)) { throw "Missing file: $src" }

  $bakDir = Join-Path $root "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

  $leaf = Split-Path $rel -Leaf
  $bak  = Join-Path $bakDir ("$leaf.bak.$tag.$ts")
  Copy-Item -LiteralPath $src -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
  return $src
}

function Assert-Path([string]$p, [string]$label) {
  if ([string]::IsNullOrWhiteSpace($p)) { throw "$label is empty." }
  if (!(Test-Path -LiteralPath $p)) { throw "$label not found: $p" }
}

function Has-NonAscii([string]$s) {
  foreach ($ch in $s.ToCharArray()) {
    if ([int][char]$ch -gt 127) { return $true }
  }
  return $false
}

Write-Host "== PATCH JRIDE: Standardize driver secret header across ANDROID + WEB (V1.1 / PS5-safe) =="

Assert-Path $AndroidRoot "AndroidRoot"
Assert-Path $WebRoot     "WebRoot"

# ---------------------------
# ANDROID: LiveLocationClient
# ---------------------------
$llRel  = "app\src\main\java\com\jride\app\LiveLocationClient.kt"
$llPath = Backup-File -root $AndroidRoot -rel $llRel -tag "DRV_SECRET_STD_V1_1_LiveLocationClient"

$ll = Get-Content -LiteralPath $llPath -Raw -Encoding UTF8
$llOrig = $ll

# Standardize header name
$ll = $ll.Replace("x-driver-ping-secret", "x-jride-driver-secret")

# Remove the early-return no-enqueue bug: client.newCall(newReq) then return
$reEarly = [regex]::new("(?s)\r?\n\s*val\s+newReq\s*=.*?\r?\n\s*client\.newCall\(newReq\)\s*\r?\n\s*return\s*\r?\n", "Singleline")
if ($reEarly.IsMatch($ll)) {
  $ll = $reEarly.Replace($ll, "`r`n")
  Write-Host "[OK] Removed LiveLocationClient early-return no-enqueue bug."
} else {
  Write-Host "[WARN] No-enqueue early-return block not matched (may already be fixed)."
}

# Ensure wallet GET attaches secret header (avoid relying on removed block)
$reWallet = [regex]::new("val\s+req\s*=\s*Request\.Builder\(\)\.url\(url\)\.get\(\)\.build\(\)", "Singleline")
if ($reWallet.IsMatch($ll)) {
  $ll = $reWallet.Replace($ll, @'
val b = Request.Builder().url(url).get()
val secret = try { (com.jride.app.BuildConfig.DRIVER_PING_SECRET ?: "").trim() } catch (_: Exception) { "" }
if (secret.isNotEmpty()) b.addHeader("x-jride-driver-secret", secret)
val req = b.build()
'@)
  Write-Host "[OK] Patched fetchWalletAsync() to attach x-jride-driver-secret."
} else {
  Write-Host "[WARN] Could not match wallet req builder line (may already be custom)."
}

if ($ll -eq $llOrig) { throw "LiveLocationClient.kt: no changes applied. Aborting." }
Write-Utf8NoBom -path $llPath -content $ll
Write-Host "[OK] Patched: $llPath"

# ------------------------
# ANDROID: MainActivity.kt
# ------------------------
$maRel  = "app\src\main\java\com\jride\app\MainActivity.kt"
$maPath = Backup-File -root $AndroidRoot -rel $maRel -tag "DRV_SECRET_STD_V1_1_MainActivity"

$ma = Get-Content -LiteralPath $maPath -Raw -Encoding UTF8
$maOrig = $ma

$ma = $ma.Replace("x-driver-ping-secret", "x-jride-driver-secret")

# Fix mojibake toast line without embedding mojibake literals:
# Replace any toast("Waiting passenger fare confirmation....") to a clean ellipsis
$ma = [regex]::Replace($ma, 'toast\("Waiting passenger fare confirmation[^"]*"\)', 'toast("Waiting passenger fare confirmation…")')

if ($ma -ne $maOrig) {
  Write-Utf8NoBom -path $maPath -content $ma
  Write-Host "[OK] Patched: $maPath"
} else {
  Write-Host "[OK] MainActivity.kt already clean (or no matching toast)."
}

# ---------------------------
# ANDROID: MatrixRainView.kt
# ---------------------------
$mrRel = "app\src\main\java\com\jride\app\MatrixRainView.kt"
$mrPath = Join-Path $AndroidRoot $mrRel
if (Test-Path -LiteralPath $mrPath) {
  $mrPath2 = Backup-File -root $AndroidRoot -rel $mrRel -tag "DRV_SECRET_STD_V1_1_MatrixRainView"
  $mr = Get-Content -LiteralPath $mrPath2 -Raw -Encoding UTF8
  $mrOrig = $mr

  if (Has-NonAscii $mr) {
    # We will NOT try to "correct" katakana here (no mojibake literals in script).
    # We only normalize to UTF-8 no-BOM to stop further corruption.
    Write-Utf8NoBom -path $mrPath -content $mr
    Write-Host "[OK] MatrixRainView.kt contains non-ASCII; normalized encoding (UTF-8 no BOM)."
  } else {
    Write-Host "[OK] MatrixRainView.kt ASCII-only."
  }
} else {
  Write-Host "[OK] MatrixRainView.kt not found; skipping."
}

# -------------------
# WEB: dispatch/status
# -------------------
$wsRel  = "app\api\dispatch\status\route.ts"
$wsPath = Backup-File -root $WebRoot -rel $wsRel -tag "DRV_SECRET_STD_V1_1_DispatchStatusRoute"

$ws = Get-Content -LiteralPath $wsPath -Raw -Encoding UTF8
$wsOrig = $ws

# Update driver secret header lookup: accept new header, fallback old
# NOTE: this modifies any occurrences safely without using '||' in PowerShell context
$ws = $ws.Replace(
  'req.headers.get("x-driver-ping-secret")',
  'req.headers.get("x-jride-driver-secret") || req.headers.get("x-driver-ping-secret")'
)

# Prefer new env var, fallback old env vars
$ws = $ws.Replace(
  'process.env.DRIVER_PING_SECRET',
  'process.env.JRIDE_DRIVER_SECRET || process.env.DRIVER_PING_SECRET'
)

# Replace remaining literal header mentions in strings/comments
$ws = $ws.Replace("x-driver-ping-secret", "x-jride-driver-secret")

if ($ws -eq $wsOrig) { throw "dispatch/status route.ts: no changes applied. Aborting." }
Write-Utf8NoBom -path $wsPath -content $ws
Write-Host "[OK] Patched: $wsPath"

Write-Host ""
Write-Host "== DONE =="
Write-Host "Android: header standardized + wallet header attached + removed no-enqueue early return (if present)"
Write-Host "Web: dispatch/status accepts x-jride-driver-secret (fallback old) + prefers JRIDE_DRIVER_SECRET"