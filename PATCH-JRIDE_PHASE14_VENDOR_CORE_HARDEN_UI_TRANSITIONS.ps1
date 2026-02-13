# PATCH-JRIDE_PHASE14_VENDOR_CORE_HARDEN_UI_TRANSITIONS.ps1
# Phase 14: Vendor Core Hardening (UI-only)
# - Disable invalid vendor status transitions (preparing->ready->driver_arrived->picked_up->completed)
# - No backend edits
# - No switch/case refactor
# - One file only: app/vendor-orders/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

if ($txt -match "PHASE14_VENDOR_CORE_HARDEN") {
  Info "Phase 14 hardening already present. No change."
  exit 0
}

# 1) Insert helper functions near your Phase 13 block (best anchor)
$anchor = '(?m)^\s*//\s*PHASE13_VENDOR_ACTION_GEO_GATE\s*$'
if ($txt -notmatch $anchor) {
  Fail "Phase 13 anchor not found. Expected: // PHASE13_VENDOR_ACTION_GEO_GATE"
}

$helpers = @'

  // PHASE14_VENDOR_CORE_HARDEN
  // UI-only vendor transition gating (fails open on unknown status to avoid regressions).
  const VENDOR_FLOW_UI = ["preparing","ready","driver_arrived","picked_up","completed"] as const;
  type VendorFlowStatus = typeof VENDOR_FLOW_UI[number];

  function normVendorFlowStatus(s: any): VendorFlowStatus | null {
    const v = String(s || "").trim();
    return (VENDOR_FLOW_UI as readonly string[]).includes(v) ? (v as VendorFlowStatus) : null;
  }

  function nextVendorFlowStatus(cur: VendorFlowStatus): VendorFlowStatus | null {
    const i = VENDOR_FLOW_UI.indexOf(cur);
    if (i < 0) return null;
    return i + 1 < VENDOR_FLOW_UI.length ? VENDOR_FLOW_UI[i + 1] : null;
  }

  function vendorCanTransitionUI(order: any, target: any): boolean {
    const cur = normVendorFlowStatus(order?.status);
    const tgt = normVendorFlowStatus(target);
    if (!cur || !tgt) return true; // fails open if unknown
    if (cur === tgt) return false; // no-op clicks disabled
    const next = nextVendorFlowStatus(cur);
    return next === tgt;
  }

'@

$txt = [regex]::Replace($txt, $anchor, '$0' + "`r`n" + $helpers, 1)
Ok "Inserted Phase 14 transition helper functions."

# 2) Harden disabled props by adding !vendorCanTransitionUI(o,"...") when we detect handleStatusUpdate(o,"...") buttons
# We add per-button gating via onClick rewrite (safer than guessing disabled layout).
# Transform:
# onClick={() => (vendorActionBlocked ? null : handleStatusUpdate(o, "ready"))}
# into:
# onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"ready") ? null : handleStatusUpdate(o, "ready"))}
$before = $txt

$txt = [regex]::Replace(
  $txt,
  'onClick=\{\(\)\s*=>\s*\(\s*vendorActionBlocked\s*\?\s*null\s*:\s*handleStatusUpdate\(\s*o\s*,\s*"([^"]+)"\s*\)\s*\)\s*\}',
  'onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"$1") ? null : handleStatusUpdate(o, "$1"))}',
  0
)

# Also handle plain calls:
# onClick={() => handleStatusUpdate(o, "ready")}
$txt = [regex]::Replace(
  $txt,
  'onClick=\{\(\)\s*=>\s*handleStatusUpdate\(\s*o\s*,\s*"([^"]+)"\s*\)\s*\}',
  'onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"$1") ? null : handleStatusUpdate(o, "$1"))}',
  0
)

if ($txt -ne $before) { Ok "Hardened onClick handlers with transition gating." }
else { Info "No onClick handlers matched (your file may use a different pattern). Transition gating helper still inserted." }

# 3) Harden disabled props where possible:
# disabled={vendorActionBlocked || updatingId === o.id}
# => disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o,"<status>")}
# We can only do this safely when the same button contains handleStatusUpdate(o,"<status>") nearby.
# We'll do a conservative local rewrite: within a button tag that contains handleStatusUpdate(o,"X"), add the condition to disabled if disabled already exists.
$btnPat = '(?s)(<button[^>]*?)(disabled=\{[^}]*\})([^>]*?>.*?handleStatusUpdate\(\s*o\s*,\s*"([^"]+)"\s*\).*?</button>)'
$txt2 = [regex]::Replace($txt, $btnPat, {
  param($m)
  $pre = $m.Groups[1].Value
  $dis = $m.Groups[2].Value
  $tail = $m.Groups[3].Value
  $st = $m.Groups[4].Value

  if ($dis -match 'vendorCanTransitionUI') { return $m.Value } # already hardened
  $newDis = $dis -replace 'disabled=\{', "disabled={"
  # insert before closing brace
  $newDis = $newDis -replace '\}\s*$', " || !vendorCanTransitionUI(o,""$st"")}"
  return $pre + $newDis + $tail
}, 0)

if ($txt2 -ne $txt) { $txt = $txt2; Ok "Hardened disabled props on buttons that call handleStatusUpdate(o, status)." }
else { Info "No disabled props patched (OK). OnClick gating still prevents invalid transitions." }

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 14 Vendor Core Hardening applied (UI-only transitions)."
