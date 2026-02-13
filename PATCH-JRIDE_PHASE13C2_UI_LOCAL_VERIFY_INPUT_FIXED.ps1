# PATCH-JRIDE_PHASE13C2_UI_LOCAL_VERIFY_INPUT_FIXED.ps1
# Phase 13-C2: UI local verification input + localStorage + booking payload wiring
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

# Idempotency
if ($txt -match "PHASE13-C2_UI_LOCAL_VERIFY") {
  Info "Phase 13-C2 already present. No change."
  exit 0
}

# ------------------------------------------------------------
# 1) Insert local verify state + helpers after geoCheckedAt line
# ------------------------------------------------------------
$geoLinePat = '(?m)^\s*const\s*\[geoCheckedAt,\s*setGeoCheckedAt\]\s*=\s*React\.useState<[^>]+>\([^)]*\);\s*$'
if ($txt -notmatch $geoLinePat) { Fail "Could not find geoCheckedAt state line." }

$stateInsert = @'

  // ===== Phase 13-C2: Local verification code (UI-only) =====
  // Allows booking if (geo ok) OR (local code present). Backend validates the code.
  const LOCAL_VERIFY_KEY = "jride.local_verify_code";
  const [localVerify, setLocalVerify] = React.useState<string>("");

  function hasLocalVerify(): boolean {
    return !!String(localVerify || "").trim();
  }
  // ===== END Phase 13-C2_UI_LOCAL_VERIFY =====

'@

$txt = [regex]::Replace($txt, $geoLinePat, '$0' + $stateInsert, 1)
Ok "Inserted localVerify state + helpers."

# ------------------------------------------------------------
# 2) Load localStorage in the existing geo useEffect (no prompt)
# ------------------------------------------------------------
$geoEffectPat = '(?s)React\.useEffect\(\(\)\s*=>\s*\{\s*[^}]*refreshGeoGate\(\{\s*prompt:\s*false\s*\}\);\s*[^}]*\}\s*,\s*\[\]\s*\);\s*'
if ($txt -notmatch $geoEffectPat) { Fail "Could not find the geo refresh useEffect block." }

$txt = [regex]::Replace($txt, $geoEffectPat, {
  param($m)
  $block = $m.Value
  if ($block -match 'LOCAL_VERIFY_KEY') { return $block } # already inserted
  $ins = @'
    // Phase 13-C2: load local verification code (UI-only)
    try {
      const v = window.localStorage.getItem(LOCAL_VERIFY_KEY);
      if (v) setLocalVerify(String(v));
    } catch {
      // ignore
    }

'@
  # insert right after refreshGeoGate({ prompt: false });
  $block2 = [regex]::Replace($block, 'refreshGeoGate\(\{\s*prompt:\s*false\s*\}\);\s*', { param($mm) $mm.Value + "`r`n" + $ins }, 1)
  return $block2
}, 1)
Ok "Inserted localStorage load in geo effect."

# ------------------------------------------------------------
# 3) Update allowSubmit: (geo ok) OR (local code present)
# ------------------------------------------------------------
$allowPat = '(?s)\s*const\s+bookingSubmitted\s*=\s*!!activeCode;\s*const\s+allowSubmit\s*=\s*[^;]+;'
if ($txt -notmatch $allowPat) { Fail "Could not find bookingSubmitted + allowSubmit block." }

$allowNew = @'
  const bookingSubmitted = !!activeCode;
  const allowSubmit =
    !busy &&
    !unverifiedBlocked &&
    !walletBlocked &&
    !bookingSubmitted &&
    (
      (geoPermission === "granted" && geoInsideIfugao === true) ||
      hasLocalVerify()
    );
'@

$txt = [regex]::Replace($txt, $allowPat, "`r`n$allowNew", 1)
Ok "Updated allowSubmit to allow geo OR local code."

# ------------------------------------------------------------
# 4) Add UI input inside the existing geo gate card
#    Insert after geoGateBlockBody() text line, before the status details.
# ------------------------------------------------------------
$geoCardPat = '(?s)\{geoGateBlocked\(\)\s*\?\s*\(\s*<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">.*?\)\s*:\s*null\}'
if ($txt -notmatch $geoCardPat) { Fail "Could not find geoGateBlocked() card block." }

$txt = [regex]::Replace($txt, $geoCardPat, {
  param($m)
  $block = $m.Value

  # Insert only once
  if ($block -match 'Local verification code \(optional\)') { return $block }

  $uiInsert = @'
                {/* PHASE13-C2_UI_LOCAL_VERIFY */}
                <div className="mt-3">
                  <label className="block text-xs font-semibold opacity-70 mb-1">
                    Local verification code (optional)
                  </label>
                  <input
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                    placeholder="Enter local code if provided"
                    value={localVerify}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLocalVerify(v);
                      try {
                        if (v) window.localStorage.setItem(LOCAL_VERIFY_KEY, v);
                        else window.localStorage.removeItem(LOCAL_VERIFY_KEY);
                      } catch {
                        // ignore
                      }
                    }}
                  />
                  <div className="mt-1 text-[11px] opacity-70">
                    Use only if location fails. Provided by JRide admin / QR / referral.
                  </div>
                </div>
                {/* END PHASE13-C2_UI_LOCAL_VERIFY */}

'@

  # Insert right after the geoGateBlockBody line:
  $block2 = [regex]::Replace(
    $block,
    '(<div className="mt-1 text-sm text-amber-900/80">\s*\{geoGateBlockBody\(\)\}\s*</div>\s*)',
    { param($mm) $mm.Value + "`r`n" + $uiInsert },
    1
  )
  return $block2
}, 1)
Ok "Inserted local code input UI inside geo gate card."

# ------------------------------------------------------------
# 5) Include local_verification_code in booking payload
# ------------------------------------------------------------
$bookPat = '(?s)const\s+book\s*=\s*await\s+postJson\(\s*"/api/public/passenger/book"\s*,\s*\{\s*.*?\}\s*\);\s*'
if ($txt -notmatch $bookPat) { Fail 'Could not find postJson("/api/public/passenger/book", {...}) block.' }

$txt = [regex]::Replace($txt, $bookPat, {
  param($m)
  $block = $m.Value
  if ($block -match 'local_verification_code') { return $block }

  # Insert before the closing brace of the body object (before "});")
  $block2 = [regex]::Replace(
    $block,
    '(?s)(\s*service:\s*"ride"\s*,\s*)',
    { param($mm) $mm.Value + 'local_verification_code: hasLocalVerify() ? localVerify : undefined,' + "`r`n        " },
    1
  )

  # If service field isn't exactly that shape, fallback insert before the object close
  if ($block2 -eq $block) {
    $block2 = [regex]::Replace(
      $block,
      '(?s)\s*\}\s*\);\s*$',
      "`r`n        local_verification_code: hasLocalVerify() ? localVerify : undefined,`r`n      });",
      1
    )
  }
  return $block2
}, 1)
Ok "Wired local_verification_code into booking payload."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-C2 UI local verification input complete."
