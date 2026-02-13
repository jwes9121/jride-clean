# PATCH-JRIDE_EMERGENCY_CROSSTOWN_STEP5A_UI_FLAG_V1_4.ps1
# STEP 5A ONLY (UI + is_emergency flag)
# Fixes scope issue: injects state INSIDE default component using React.useState (no import editing).
# Also removes any stray top-level isEmergency injection if present.

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Require-Anchor($txt, $needle, $path) {
  if ($txt.IndexOf($needle) -lt 0) {
    throw ("Anchor not found in {0}`n---needle---`n{1}`n------------" -f $path, $needle)
  }
}

$root = (Get-Location).Path
$path = Join-Path $root "app\ride\page.tsx"
Backup-File $path

$txt = Get-Content -LiteralPath $path -Raw

# 0) Remove any previously injected TOP-LEVEL isEmergency block (outside component) to avoid confusion
# We remove the exact block that starts with "const [isEmergency, setIsEmergency]" up to the end marker if it exists.
$start = $txt.IndexOf("const [isEmergency, setIsEmergency]")
if ($start -ge 0) {
  # If it is already inside our marker, we won't delete it.
  $markerStart = $txt.IndexOf("/* ===== JRIDE_STEP5A_EMERGENCY_STATE ===== */")
  if ($markerStart -ge 0) {
    # already has controlled marker; do not blanket remove
  } else {
    # Try remove until after "const noDriversInTown" helper if present
    $endMarker = $txt.IndexOf("})();", $start)
    if ($endMarker -ge 0) {
      $endMarker = $endMarker + 4
      $before0 = $txt.Substring(0, $start)
      $after0  = $txt.Substring($endMarker)
      $txt = $before0 + $after0
      Write-Host "[OK] Removed stray top-level isEmergency/noDriversInTown block"
    }
  }
}

# 1) Inject state inside default export component
$fnNeedle = "export default function"
Require-Anchor $txt $fnNeedle $path

$fnPos = $txt.IndexOf($fnNeedle)
$bracePos = $txt.IndexOf("{", $fnPos)
if ($bracePos -lt 0) { throw "Could not find '{' after 'export default function'." }

$marker = "/* ===== JRIDE_STEP5A_EMERGENCY_STATE ===== */"
if ($txt -match [regex]::Escape($marker)) {
  Write-Host "[SKIP] STEP5A state marker already present"
} else {
  $inject = @'
/* ===== JRIDE_STEP5A_EMERGENCY_STATE ===== */
const [isEmergency, setIsEmergency] = React.useState(false);

/**
 * STEP 5A: Emergency cross-town dispatch (UI + flag only)
 * Show Emergency button when there are NO available drivers in passenger's town.
 * If your ride page uses different variables, update detection inside this helper.
 */
const noDriversInTown = (() => {
  try {
    // @ts-ignore
    if (typeof hasAvailableDriverInTown === "boolean") return !hasAvailableDriverInTown;
  } catch {}
  try {
    // @ts-ignore
    if (Array.isArray(availableDriversInTown)) return availableDriversInTown.length === 0;
  } catch {}
  try {
    // @ts-ignore
    if (Array.isArray(driversInTown)) return driversInTown.length === 0;
  } catch {}
  return false;
})();
/* ===== END JRIDE_STEP5A_EMERGENCY_STATE ===== */

'@

  $before1 = $txt.Substring(0, $bracePos + 1)
  $after1  = $txt.Substring($bracePos + 1)
  $txt = $before1 + "`r`n" + $inject + $after1
  Write-Host "[OK] Injected STEP5A state inside default component"
}

# 2) Ensure payload includes is_emergency: isEmergency (first JSON.stringify({ ... }))
if ($txt -match "is_emergency:\s*isEmergency") {
  Write-Host "[OK] Payload already contains is_emergency: isEmergency"
} else {
  $needleBody = "JSON.stringify({"
  $posBody = $txt.IndexOf($needleBody)
  if ($posBody -lt 0) { throw "Anchor not found: JSON.stringify({" }

  $before2 = $txt.Substring(0, $posBody + $needleBody.Length)
  $after2  = $txt.Substring($posBody + $needleBody.Length)
  $txt = $before2 + "`r`n      is_emergency: isEmergency," + $after2
  Write-Host "[OK] Injected is_emergency into first JSON.stringify({ ... })"
}

# 3) Inject Emergency UI block before the FIRST <button if not already present
$uiMarker = "STEP 5A: EMERGENCY CROSS-TOWN DISPATCH (UI + FLAG ONLY)"
if ($txt -match [regex]::Escape($uiMarker)) {
  Write-Host "[SKIP] Emergency UI block already present"
} else {
  $uiNeedle = "<button"
  Require-Anchor $txt $uiNeedle $path

  $emergencyBlock = @'
{/* ===== STEP 5A: EMERGENCY CROSS-TOWN DISPATCH (UI + FLAG ONLY) ===== */}
{noDriversInTown ? (
  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
    <div className="text-sm font-semibold text-amber-900">No drivers available in your town</div>
    <div className="mt-1 text-xs text-amber-900/80">
      Book drivers from nearby towns. Free pickup within 1.5km. Additional distance has extra fee.
    </div>
    <button
      type="button"
      onClick={() => setIsEmergency(true)}
      className={"mt-2 w-full rounded-xl px-4 py-2 text-sm font-semibold " + (isEmergency ? "bg-amber-200 text-amber-900" : "bg-amber-600 text-white hover:bg-amber-700")}
    >
      {isEmergency ? "Emergency enabled (nearby towns)" : "Emergency: book nearby-town drivers"}
    </button>
    {isEmergency ? (
      <div className="mt-2 text-[11px] text-amber-900/80">
        Emergency mode is ON. We will attempt to dispatch drivers from nearby towns.
      </div>
    ) : null}
  </div>
) : null}
{/* ===== END STEP 5A ===== */}

'@

  $txt = $txt.Replace($uiNeedle, ($emergencyBlock + $uiNeedle), 1)
  Write-Host "[OK] Injected Emergency UI block"
}

# 4) Write back UTF8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8NoBom)

Write-Host "[DONE] Patched: $path"
Write-Host ""
Write-Host "NEXT: npm run build"
