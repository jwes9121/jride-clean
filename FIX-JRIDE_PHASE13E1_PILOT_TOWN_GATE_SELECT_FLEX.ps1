# FIX-JRIDE_PHASE13E1_PILOT_TOWN_GATE_SELECT_FLEX.ps1
# Phase 13-E1: Disable/gray out Kiangan + Lamut (pilot gating) with flexible anchors
# File: app/ride/page.tsx
# One file only. No manual edits.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\ride\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# 0) Ensure pilot allow-list exists (your previous script already inserted it, but keep safe)
if ($txt -notmatch "PHASE13-E1_PILOT_TOWN_GATE") {
  $anchorTown = '(?m)^\s*const\s*\[town,\s*setTown\]\s*=\s*React\.useState\("Lagawe"\);\s*$'
  if ($txt -notmatch $anchorTown) { Fail "Town state anchor not found." }

  $ins = @'

  // PHASE13-E1_PILOT_TOWN_GATE (UI-only)
  // Pilot towns enabled: Lagawe, Hingyon, Banaue
  // Temporarily disabled (paperwork pending): Kiangan, Lamut
  const PILOT_TOWNS = ["Lagawe", "Hingyon", "Banaue"] as const;
  function isPilotTown(t: string): boolean {
    return PILOT_TOWNS.indexOf((String(t || "").trim() as any)) >= 0;
  }

'@
  $txt = [regex]::Replace($txt, $anchorTown, '$0' + $ins, 1)
  Ok "Inserted pilot towns allow-list."
} else {
  Info "Pilot towns allow-list already present."
}

# 1) Disable the option tags (no order assumptions)
$beforeKiangan = ($txt -match '<option value="Kiangan"').Count
$beforeLamut   = ($txt -match '<option value="Lamut"').Count

# Replace exact simple option forms:
# <option value="Kiangan">Kiangan</option>
$txt2 = [regex]::Replace(
  $txt,
  '(?s)<option\s+value="Kiangan"\s*>\s*Kiangan\s*</option>',
  '<option value="Kiangan" disabled>Kiangan (pending)</option>'
)
$txt2 = [regex]::Replace(
  $txt2,
  '(?s)<option\s+value="Lamut"\s*>\s*Lamut\s*</option>',
  '<option value="Lamut" disabled>Lamut (pending)</option>'
)

# If they already had extra attrs (rare), still force disabled:
$txt2 = [regex]::Replace(
  $txt2,
  '(?s)<option([^>]*\s)value="Kiangan"([^>]*)>(.*?)</option>',
  '<option value="Kiangan" disabled>Kiangan (pending)</option>'
)
$txt2 = [regex]::Replace(
  $txt2,
  '(?s)<option([^>]*\s)value="Lamut"([^>]*)>(.*?)</option>',
  '<option value="Lamut" disabled>Lamut (pending)</option>'
)

$txt = $txt2
Ok "Disabled Kiangan + Lamut <option> tags."

# 2) Enforce pilot town gating in allowSubmit (without assuming exact block shape)
# Insert helper vars immediately before: const allowSubmit =
if ($txt -notmatch '(?m)^\s*const\s+allowSubmit\s*=') { Fail "Could not find const allowSubmit = ..." }

if ($txt -notmatch "pilotTownAllowed") {
  $txt = [regex]::Replace(
    $txt,
    '(?m)^\s*const\s+allowSubmit\s*=',
@'
  // PHASE13-E1: pilot town gate (UI-only)
  const pilotTownAllowed = isPilotTown(town);

  // Phase 13: booking allowed if (geo ok) OR (local verification code present)
  const geoOk = (geoPermission === "granted" && geoInsideIfugao === true);
  const geoOrLocalOk = geoOk || hasLocalVerify();

  const allowSubmit =
'@,
    1
  )
  Ok "Inserted pilotTownAllowed + geoOrLocalOk variables before allowSubmit."
} else {
  Info "pilotTownAllowed already present (skip var insert)."
}

# Now make sure allowSubmit includes pilotTownAllowed and geoOrLocalOk.
# We replace ONLY the allowSubmit assignment expression up to its semicolon.
$allowExprPat = '(?s)(?m)^\s*const\s+allowSubmit\s*=\s*.*?;\s*$'
if ($txt -notmatch $allowExprPat) { Fail "Could not locate allowSubmit assignment line/statement." }

$txt = [regex]::Replace(
  $txt,
  $allowExprPat,
@'
  const allowSubmit =
    !busy &&
    !unverifiedBlocked &&
    !walletBlocked &&
    !bookingSubmitted &&
    pilotTownAllowed &&
    geoOrLocalOk;
'@,
  1
)
Ok "Updated allowSubmit to include pilotTownAllowed + geoOrLocalOk."

# 3) Optional: add a small pilot note under the Town select (only if not present)
if ($txt -notmatch "Pilot phase:") {
  # Find the FIRST town <select ... value={town} ...>...</select> and add note right after it.
  $selPat = '(?s)(<select[^>]*value=\{town\}[^>]*>.*?</select>)'
  if ($txt -match $selPat) {
    $txt = [regex]::Replace(
      $txt,
      $selPat,
@'
$1
            <div className="mt-2 text-xs text-amber-900/80">
              Pilot phase: <b>Lagawe</b>, <b>Hingyon</b>, <b>Banaue</b> enabled. <b>Kiangan</b> and <b>Lamut</b> are temporarily disabled for pickup.
            </div>
'@,
      1
    )
    Ok "Inserted pilot note under the Town dropdown."
  } else {
    Info "Town <select value={town}> block not found for note insert (skip note)."
  }
} else {
  Info "Pilot note already present."
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-E1 pilot town gate completed (Kiangan/Lamut disabled for pickup)."
