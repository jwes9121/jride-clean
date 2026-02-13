# PATCH-JRIDE_CANBOOK_DEBUG_AUTH_V2_PS5SAFE.ps1
# PS5-safe, idempotent. Targets ONLY: app/api/public/passenger/can-book/route.ts
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Get-Timestamp { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Find-RepoRoot([string]$StartDir) {
  $dir = Resolve-Path -LiteralPath $StartDir
  while ($true) {
    $pkg = Join-Path -Path $dir -ChildPath "package.json"
    if (Test-Path -LiteralPath $pkg) { return $dir.Path }
    $parent = Split-Path -Path $dir -Parent
    if (-not $parent -or $parent -eq $dir.Path) { break }
    $dir = $parent
  }
  throw "Could not locate repo root (package.json) from: $StartDir"
}

Write-Host "== JRide Patch: can-book debug auth meta (V2 / PS5-safe) =="

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Find-RepoRoot -StartDir $scriptDir
Ok "RepoRoot: $repoRoot"

$targetRel = "app\api\public\passenger\can-book\route.ts"
$target    = Join-Path -Path $repoRoot -ChildPath $targetRel
if (-not (Test-Path -LiteralPath $target)) { throw "Target not found: $target" }
Ok "Target: $target"

# Backup
$bakDir = Join-Path -Path $repoRoot -ChildPath "_patch_bak"
if (-not (Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$bak = Join-Path -Path $bakDir -ChildPath ("route.ts.bak." + (Get-Timestamp))
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src
$changed = $false

# 1) Ensure we stash userId into out.user_id when user exists.
# Look for: const userId = user.id;
if ($src -match 'const\s+userId\s*=\s*user\.id\s*;') {
  # Only inject if not already present nearby
  if ($src -notmatch '\(out\s+as\s+any\)\.user_id\s*=\s*userId') {
    $src2 = [regex]::Replace(
      $src,
      'const\s+userId\s*=\s*user\.id\s*;\s*',
      'const userId = user.id;' + "`n" + '  (out as any).user_id = userId;' + "`n",
      1
    )
    if ($src2 -ne $src) { $src = $src2; $changed = $true; Ok "Injected: (out as any).user_id = userId;" }
  } else {
    Ok "Skip: out.user_id already set."
  }
} else {
  Warn "Could not find 'const userId = user.id;'. If auth code differs, debug_user_id may stay null."
}

# 2) Inject debug fields into every meta: { ... } block (handles shorthand like nightGate,)
# Idempotent: if debug_has_user already exists anywhere, we don't inject again.
if ($src -notmatch 'debug_has_user') {
  $inject = 'meta: {' + "`n" +
            '      debug_has_user: !!(v as any).user_id,' + "`n" +
            '      debug_user_id: (v as any).user_id ?? null,'

  # Replace ALL occurrences of "meta: {" with injected header (keeps rest of object intact)
  $src2 = [regex]::Replace($src, 'meta:\s*\{', $inject)
  if ($src2 -ne $src) { $src = $src2; $changed = $true; Ok "Injected: debug_has_user/debug_user_id into meta blocks." }
  else { Warn "Could not find any 'meta: {' blocks to patch." }
} else {
  Ok "Skip: debug_has_user already present."
}

if (-not $changed) {
  Ok "No changes needed (already patched / idempotent)."
} else {
  Set-Content -LiteralPath $target -Value $src -Encoding UTF8
  Ok "Patched successfully."
}

Ok "DONE. Next: npm.cmd run build, then run dev and re-hit /api/public/passenger/can-book."
