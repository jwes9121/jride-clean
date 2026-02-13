# PATCH-JRIDE_DISPATCH_STATUS_ACCEPTED_FARE_PROPOSED_V1_3.ps1
# Robust patch for app\api\dispatch\status\route.ts using raw-text anchored edits:
# - Add "accepted" and "fare_proposed" to ALLOWED
# - Add assigned -> accepted transition
# - Add NEXT.accepted and NEXT.fare_proposed entries
# PS5-safe, backup-first, idempotent

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path
$Rel = "app\api\dispatch\status\route.ts"
$File = Join-Path $RepoRoot $Rel

if (-not (Test-Path -LiteralPath $File)) {
  Die "[FAIL] Missing file: $File (run from Next.js repo root)"
}

$BakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $BakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $BakDir ("dispatch-status.route.ts.bak." + $ts)
Copy-Item -LiteralPath $File -Destination $bak -Force
Ok ("[OK] Backup: " + $bak)

$src = Get-Content -LiteralPath $File -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($src)) {
  Die "[FAIL] route.ts read as empty. Abort."
}

# -------- 1) ALLOWED: insert accepted + fare_proposed after assigned ----------
if ($src -notmatch '"accepted"' -or $src -notmatch '"fare_proposed"') {
  $before = $src
  # Anchor on the known sequence you showed in audit: "assigned" then "on_the_way"
  $src = [regex]::Replace(
    $src,
    '("assigned"\s*,\s*\r?\n)(\s*)"on_the_way"',
    '${1}${2}"accepted",' + "`r`n" + '${2}"fare_proposed",' + "`r`n" + '${2}"on_the_way"',
    1
  )

  if ($src -eq $before) {
    Die "[FAIL] Could not patch ALLOWED (anchor ""assigned"" -> ""on_the_way"" not found)."
  }
  Ok "[OK] Patched ALLOWED: added accepted + fare_proposed."
} else {
  Warn "[WARN] ALLOWED already includes accepted + fare_proposed; skipping."
}

# -------- 2) NEXT.assigned: ensure it includes accepted first ----------
# Anchor on: assigned: ["on_the_way", ...]
if ($src -match 'assigned\s*:\s*\[\s*"on_the_way"') {
  $src = [regex]::Replace(
    $src,
    'assigned\s*:\s*\[\s*"on_the_way"',
    'assigned: ["accepted", "on_the_way"',
    1
  )
  Ok "[OK] Patched NEXT.assigned: added accepted."
} elseif ($src -match 'assigned\s*:\s*\[\s*"accepted"') {
  Warn "[WARN] NEXT.assigned already starts with accepted; skipping."
} else {
  Warn "[WARN] Could not find NEXT.assigned anchor; skipping this part."
}

# -------- 3) Insert NEXT.accepted and NEXT.fare_proposed entries ----------
# We'll insert right after the assigned: [...] line inside const NEXT = { ... }
$lines = $src -split "`r?`n"
$nextIdx = -1
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^\s*const\s+NEXT\b') { $nextIdx = $i; break }
}
if ($nextIdx -lt 0) {
  Die "[FAIL] Could not locate const NEXT block."
}

$hasNextAccepted = ($src -match '^\s*accepted\s*:\s*\[')
$hasNextFareProposed = ($src -match '^\s*fare_proposed\s*:\s*\[')

# Find the assigned line within NEXT block
$assignedLine = -1
for ($i=$nextIdx; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^\s*assigned\s*:\s*\[') { $assignedLine = $i; break }
  if ($lines[$i] -match '^\s*\}\s*;\s*$') { break }
}
if ($assignedLine -lt 0) {
  Warn "[WARN] Could not find assigned line inside NEXT block; skipping insert of accepted/fare_proposed keys."
} else {
  $indent = ($lines[$assignedLine] -replace '(assigned.*)$','')
  if ([string]::IsNullOrWhiteSpace($indent)) { $indent = "  " }

  $insert = @()

  if (-not $hasNextAccepted) {
    $insert += ($indent + 'accepted: ["fare_proposed", "cancelled"],')
  }
  if (-not $hasNextFareProposed) {
    $insert += ($indent + 'fare_proposed: ["on_the_way", "arrived", "enroute", "cancelled"],')
  }

  if ($insert.Count -gt 0) {
    $pos = $assignedLine + 1
    $lines = @(
      $lines[0..($pos-1)]
      $insert
      $lines[$pos..($lines.Length-1)]
    )
    Ok "[OK] Inserted NEXT.accepted / NEXT.fare_proposed (if missing)."
  } else {
    Warn "[WARN] NEXT.accepted and NEXT.fare_proposed already exist; skipping."
  }
}

$final = ($lines -join "`r`n")
Set-Content -LiteralPath $File -Value $final -Encoding UTF8
Ok ("[OK] Patched: " + $Rel)
Ok "== DONE =="
