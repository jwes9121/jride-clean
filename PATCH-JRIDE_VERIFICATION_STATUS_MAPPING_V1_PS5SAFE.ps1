# PATCH-JRIDE_VERIFICATION_STATUS_MAPPING_V1_PS5SAFE.ps1
# PS5-safe, idempotent, loud-fail patch.
# Targets ONLY: app/api/public/passenger/can-book/route.ts
# Goal: approved_admin -> verified and verified flag computed from mapped status.

$ErrorActionPreference = "Stop"

function Write-Ok($m)   { Write-Host "[OK]  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "[ERR] $m" -ForegroundColor Red }

function Get-Timestamp {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function Find-RepoRoot([string]$StartDir) {
  $dir = Resolve-Path -LiteralPath $StartDir
  while ($true) {
    $pkg = Join-Path -Path $dir -ChildPath "package.json"
    if (Test-Path -LiteralPath $pkg) { return ($dir.Path) }

    $parent = Split-Path -Path $dir -Parent
    if (-not $parent -or $parent -eq $dir.Path) { break }
    $dir = $parent
  }
  throw "Could not locate repo root (package.json) walking upward from: $StartDir"
}

function Backup-File([string]$FilePath, [string]$RepoRoot) {
  $bakDir = Join-Path -Path $RepoRoot -ChildPath "_patch_bak"
  if (-not (Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $ts = Get-Timestamp
  $leaf = Split-Path -Path $FilePath -Leaf
  $bak = Join-Path -Path $bakDir -ChildPath ($leaf + ".bak." + $ts)
  Copy-Item -LiteralPath $FilePath -Destination $bak -Force
  return $bak
}

function Replace-Regex([string]$Text, [string]$Pattern, [string]$Replacement, [ref]$DidChange) {
  $new = [regex]::Replace($Text, $Pattern, $Replacement)
  if ($new -ne $Text) { $DidChange.Value = $true }
  return $new
}

Write-Host "== JRide Patch: Verification status mapping -> can-book (PS5-safe) =="

# --- Resolve repo root safely as a SINGLE string ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Find-RepoRoot -StartDir $scriptDir
if (-not ($repoRoot -is [string])) { throw "RepoRoot is not a string (unexpected). Type=$($repoRoot.GetType().FullName)" }

Write-Ok ("RepoRoot: " + $repoRoot)

# --- Target file ONLY ---
$targetRel = "app\api\public\passenger\can-book\route.ts"
$target = Join-Path -Path $repoRoot -ChildPath $targetRel

if (-not (Test-Path -LiteralPath $target)) {
  throw "Target not found: $target"
}
Write-Ok ("Target: " + $target)

# --- Backup ---
$bak = Backup-File -FilePath $target -RepoRoot $repoRoot
Write-Ok ("Backup: " + $bak)

# --- Read ---
$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Guard: must mention passenger_verifications logic somehow
if ($src -notmatch "passenger_verifications") {
  Write-Warn "Could not see 'passenger_verifications' in can-book route.ts. Patch will still proceed, but verify this is the right file."
}

# Must contain statuses we plan to map
if ($src -notmatch "approved_admin") {
  throw "Cannot find 'approved_admin' anywhere in the target file. Refusing to patch blindly."
}

$changed = $false

# --- 1) Ensure mapping entries are correct (supports object-style maps) ---
# approved_admin => verified
$src = Replace-Regex $src '(approved_admin\s*:\s*["''])([^"'']*)(["''])' '${1}verified${3}' ([ref]$changed)

# pre_approved_dispatcher => pending_admin
$src = Replace-Regex $src '(pre_approved_dispatcher\s*:\s*["''])([^"'']*)(["''])' '${1}pending_admin${3}' ([ref]$changed)

# pending => submitted
$src = Replace-Regex $src '(\bpending\s*:\s*["''])([^"'']*)(["''])' '${1}submitted${3}' ([ref]$changed)

# rejected => rejected (normalizes any wrong mapping)
$src = Replace-Regex $src '(\brejected\s*:\s*["''])([^"'']*)(["''])' '${1}rejected${3}' ([ref]$changed)

# --- 2) Ensure "verified" boolean is derived ONLY from mapped status ---
# Try common variable names first.
if ($src -match 'const\s+verified\s*=\s*[^;]+;') {
  if ($src -match 'mappedStatus') {
    $src = Replace-Regex $src 'const\s+verified\s*=\s*[^;]+;' 'const verified = mappedStatus === "verified";' ([ref]$changed)
  } elseif ($src -match 'verification_status') {
    $src = Replace-Regex $src 'const\s+verified\s*=\s*[^;]+;' 'const verified = verification_status === "verified";' ([ref]$changed)
  } elseif ($src -match 'verificationStatus') {
    $src = Replace-Regex $src 'const\s+verified\s*=\s*[^;]+;' 'const verified = verificationStatus === "verified";' ([ref]$changed)
  } else {
    # fallback: keep original, but warn loudly
    Write-Warn "Found 'const verified = ...' but could not detect mapped status variable name (mappedStatus/verification_status/verificationStatus). Leaving verified assignment as-is."
  }
} else {
  Write-Warn "Could not find 'const verified = ...;' line. If your code computes verified inline, verify it is strictly based on mapped status == 'verified'."
}

# --- 3) Final sanity: ensure approved_admin maps to verified somewhere in file ---
if ($src -notmatch 'approved_admin\s*:\s*["'']verified["'']') {
  Write-Warn "Did not detect literal 'approved_admin: \"verified\"' after patch. Mapping may be implemented via switch/if, not an object. Manually confirm output of /can-book."
}

# --- Write only if changed ---
if ($changed) {
  Set-Content -LiteralPath $target -Value $src -Encoding UTF8
  Write-Ok "Patched can-book mapping + verified derivation (where applicable)."
} else {
  Write-Ok "No changes needed (already compliant / idempotent)."
}

Write-Host ""
Write-Ok "DONE. Next: npm.cmd run build, then re-test /api/public/passenger/can-book."
