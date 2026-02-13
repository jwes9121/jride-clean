# PATCH-JRIDE_PHASE9A_DISPATCH_CONFIDENCE.ps1
# Phase 9A (UI): Highlight recommended action + de-emphasize others + confirm force end on on_trip
# ASCII-safe, PS5-safe. No Mapbox changes.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Backup($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Ok "Backup: $p.bak.$ts"
}

$path = "app\admin\livetrips\LiveTripsClient.tsx"
Backup $path

$txt = Get-Content $path -Raw -Encoding UTF8

# ----------------------------
# 1) Recommended styling: Nudge and Auto-assign buttons
# Replace border-black emphasis with true primary style and de-emphasis for others when primary exists.
# ----------------------------

# Nudge: primary === "NUDGE_DRIVER" ? "border-black" : ""
if($txt -match 'primary\s*===\s*"NUDGE_DRIVER"\s*\?\s*"border-black"\s*:\s*""'){
  $txt = $txt -replace 'primary\s*===\s*"NUDGE_DRIVER"\s*\?\s*"border-black"\s*:\s*""',
    'primary === "NUDGE_DRIVER" ? "bg-black text-white border-black" : (primary ? "opacity-60" : "")'
  Ok "Patched Nudge button styling (recommended highlight + de-emphasis)"
} else {
  Warn "Nudge styling anchor not found (skipped)"
}

# Auto-assign: primary === "AUTO_ASSIGN" ? "border-black" : ""
if($txt -match 'primary\s*===\s*"AUTO_ASSIGN"\s*\?\s*"border-black"\s*:\s*""'){
  $txt = $txt -replace 'primary\s*===\s*"AUTO_ASSIGN"\s*\?\s*"border-black"\s*:\s*""',
    'primary === "AUTO_ASSIGN" ? "bg-black text-white border-black" : (primary ? "opacity-60" : "")'
  Ok "Patched Auto-assign button styling (recommended highlight + de-emphasis)"
} else {
  Warn "Auto-assign styling anchor not found (skipped)"
}

# Reassign: de-emphasize when primary exists (optional)
# Convert className="rounded border ... disabled:opacity-40" to className={[..., primary ? "opacity-60" : ""].join(" ")}
$reassignPattern = 'className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"'
if($txt -match $reassignPattern){
  $txt = $txt -replace $reassignPattern,
    'className={["rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40", primary ? "opacity-60" : ""].join(" ")}'
  Ok "Patched Reassign button styling (de-emphasis when a recommended action exists)"
} else {
  Warn "Reassign className anchor not found (skipped)"
}

# ----------------------------
# 2) Force end confirmation ONLY when status is on_trip
# We patch the per-row Force end button handler:
# forceTripStatus(...,"completed") => confirm when effective status is on_trip
# ----------------------------

# We look for the exact onClick call for Force end
$forceEndPattern = 'onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*forceTripStatus\(\(t as any\)\?\.booking_code,\s*"completed"\);\s*\}\s*\}'
if($txt -match $forceEndPattern){
  $forceEndReplacement = @'
onClick={(e) => {
                            e.stopPropagation();
                            const st = effectiveStatus(t as any);
                            if (st === "on_trip") {
                              if (!confirm("Force end this on_trip ride? This will set status to completed.")) return;
                            }
                            forceTripStatus((t as any)?.booking_code, "completed");
                          }}
'@
  $txt = [regex]::Replace($txt, $forceEndPattern, $forceEndReplacement, 1)
  Ok "Patched Force end to confirm when on_trip"
} else {
  Warn "Force end onClick anchor not found (skipped)"
}

# ----------------------------
# 3) Optional: De-emphasize lifecycle buttons when a Problem trip exists
# We do NOT change behavior; only style when prob is true.
# (Safe and minimal: skip if not found)
# ----------------------------

# If your file includes a className string we can safely adjust, we do it.
# Otherwise we skip.

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Phase 9A UI patch applied to LiveTripsClient.tsx"
