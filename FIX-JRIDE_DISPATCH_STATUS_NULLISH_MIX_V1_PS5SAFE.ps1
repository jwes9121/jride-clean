param(
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Backup-File([string]$root, [string]$rel, [string]$tag) {
  $src = Join-Path $root $rel
  if (!(Test-Path -LiteralPath $src)) { throw "Missing file: $src" }
  $bakDir = Join-Path $root "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  $bak = Join-Path $bakDir ((Split-Path $rel -Leaf) + ".bak.$tag.$ts")
  Copy-Item -LiteralPath $src -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
  return $src
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

Write-Host "== FIX JRIDE: dispatch/status remove ??/|| mixing (V1 / PS5-safe) =="

$rel  = "app\api\dispatch\status\route.ts"
$path = Backup-File -root $WebRoot -rel $rel -tag "DISPATCH_STATUS_NULLISH_MIX_V1"
$s = Get-Content -LiteralPath $path -Raw -Encoding UTF8
$orig = $s

# --- Replace ANY driverSecret line that contains x-jride-driver-secret and uses ?? or repeats ---
# We match the whole statement up to .trim();
$driverSecretNew = '  const driverSecret = String(req.headers.get("x-jride-driver-secret") || req.headers.get("x-driver-ping-secret") || req.headers.get("x-driver-secret") || "").trim();'

$patternDriverSecret = '(?m)^\s*const\s+driverSecret\s*=\s*String\([^;]*x-jride-driver-secret[^;]*\)\.trim\(\);\s*$'
if ($s -match $patternDriverSecret) {
  $s = [regex]::Replace($s, $patternDriverSecret, $driverSecretNew)
  Write-Host "[OK] Patched driverSecret (normalized header chain)."
} else {
  Write-Host "[WARN] driverSecret pattern not matched (file may have diverged)."
}

# Some files indent with 'let actorUserId' then 'const driverSecret' (two places). Do a looser pass too.
$patternDriverSecretLoose = '(?m)^\s*const\s+driverSecret\s*=\s*String\([^;]*\)\.trim\(\);\s*$'
# Only replace lines that contain x-jride-driver-secret AND have ?? somewhere (the broken ones)
$s = [regex]::Replace(
  $s,
  '(?m)^\s*const\s+driverSecret\s*=\s*String\((?:(?!;).)*x-jride-driver-secret(?:(?!;).)*\)\.trim\(\);\s*$',
  $driverSecretNew
)

# --- Replace ANY wantDriverSecret line that mixes || and ?? ---
$wantDriverSecretNew = '  const wantDriverSecret = String(process.env.JRIDE_DRIVER_SECRET || process.env.DRIVER_PING_SECRET || process.env.DRIVER_API_SECRET || "").trim();'

$patternWant = '(?m)^\s*const\s+wantDriverSecret\s*=\s*String\([^;]*\)\.trim\(\);\s*$'
if ($s -match $patternWant) {
  # Replace all occurrences (there are duplicates in your file)
  $s = [regex]::Replace($s, $patternWant, $wantDriverSecretNew)
  Write-Host "[OK] Patched wantDriverSecret (normalized env chain)."
} else {
  Write-Host "[WARN] wantDriverSecret pattern not matched (file may have diverged)."
}

# Safety: ensure we actually changed something
if ($s -eq $orig) { throw "No changes applied. That means your file no longer matches the broken patterns we saw in the build error." }

Write-Utf8NoBom -path $path -content $s
Write-Host "[OK] Wrote: $path"
Write-Host "== DONE =="