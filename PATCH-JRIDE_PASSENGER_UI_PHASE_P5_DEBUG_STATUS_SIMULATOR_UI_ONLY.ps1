# PATCH-JRIDE_PASSENGER_UI_PHASE_P5_DEBUG_STATUS_SIMULATOR_UI_ONLY.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES / NO_BOOKING_REQUIRED
# Adds ?debug_status=... override for ride status UI preview (P1/P3/P4 compatible).
# Patches ONLY: app\ride\page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path,$text,[System.Text.UTF8Encoding]::new($false))
}
function Backup-File($path){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.bak.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t0 = Read-Utf8NoBom $target
$t  = $t0

# Idempotency
if($t.IndexOf("PHASE P5: Debug status simulator (UI-only)") -ge 0){
  Write-Host "[OK] PHASE P5 already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# ---------- 1) Insert top-level helpers (module scope) ----------
$insertAnchor = "/* ===== END PHASE P4 PREFLIGHT HELPERS (AUTO) ===== */"
if($t.IndexOf($insertAnchor) -lt 0){
  $insertAnchor = "/* ===== END PHASE P3 TOPLEVEL EXPLAIN BLOCK (AUTO) ===== */"
}
if($t.IndexOf($insertAnchor) -lt 0){
  # Fallback: after imports area (best-effort)
  $scanLimit = [Math]::Min($t.Length, 8000)
  $head = $t.Substring(0, $scanLimit)
  $lastImportPos = $head.LastIndexOf("import ")
  if($lastImportPos -ge 0){
    $afterLastImportLine = $head.IndexOf("`n", $lastImportPos)
    if($afterLastImportLine -lt 0){ $afterLastImportLine = $lastImportPos }
    $doubleNl = $head.IndexOf("`n`n", $afterLastImportLine)
    if($doubleNl -lt 0){ $insertPos = $afterLastImportLine + 1 } else { $insertPos = $doubleNl + 2 }
  } else {
    $insertPos = 0
  }

  $p5Helpers = @'
/* ===== PHASE P5: Debug status simulator (UI-only) ===== */
function p5GetDebugStatus(): string {
  try {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search || "");
    const v = String(sp.get("debug_status") || "").trim().toLowerCase();
    // Allow only known statuses (safe UI preview)
    const allowed = new Set([
      "requested","assigned","on_the_way","arrived","on_trip","completed","cancelled"
    ]);
    return allowed.has(v) ? v : "";
  } catch {
    return "";
  }
}

function p5OverrideStatus(liveStatus: any): any {
  const dbg = p5GetDebugStatus();
  return dbg ? dbg : liveStatus;
}
/* ===== END PHASE P5 ===== */

'@
  $t = $t.Substring(0,$insertPos) + $p5Helpers + "`n" + $t.Substring($insertPos)
} else {
  $p5Helpers = @'
/* ===== PHASE P5: Debug status simulator (UI-only) ===== */
function p5GetDebugStatus(): string {
  try {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search || "");
    const v = String(sp.get("debug_status") || "").trim().toLowerCase();
    const allowed = new Set([
      "requested","assigned","on_the_way","arrived","on_trip","completed","cancelled"
    ]);
    return allowed.has(v) ? v : "";
  } catch {
    return "";
  }
}

function p5OverrideStatus(liveStatus: any): any {
  const dbg = p5GetDebugStatus();
  return dbg ? dbg : liveStatus;
}
/* ===== END PHASE P5 ===== */

'@

  # Insert AFTER the anchor line
  $p = $t.IndexOf($insertAnchor)
  $e = $t.IndexOf("`n", $p)
  if($e -lt 0){ $e = $t.Length }
  $t = $t.Substring(0,$e+1) + $p5Helpers + "`n" + $t.Substring($e+1)
}

# ---------- 2) Rewrite key P1 calls to use override ----------
# These are safe global string replacements; no regex.
$t = $t.Replace("p1RenderStepper(liveStatus)", "p1RenderStepper(p5OverrideStatus(liveStatus))")
$t = $t.Replace("p1NowMessage(liveStatus)", "p1NowMessage(p5OverrideStatus(liveStatus))")
$t = $t.Replace("p1WaitHint(liveStatus)", "p1WaitHint(p5OverrideStatus(liveStatus))")
$t = $t.Replace("p1IsNonCancellable(liveStatus)", "p1IsNonCancellable(p5OverrideStatus(liveStatus))")

# Some codebases call p1* with String(liveStatus) — cover common spacing variations
$t = $t.Replace("p1NowMessage(String(liveStatus))", "p1NowMessage(p5OverrideStatus(liveStatus))")
$t = $t.Replace("p1WaitHint(String(liveStatus))", "p1WaitHint(p5OverrideStatus(liveStatus))")
$t = $t.Replace("p1RenderStepper(String(liveStatus))", "p1RenderStepper(p5OverrideStatus(liveStatus))")

# ---------- 3) Add a small debug banner near the stepper ----------
# Anchor on the stepper call line (now replaced). Inject banner right after.
$needle = "p1RenderStepper(p5OverrideStatus(liveStatus))"
$idx = $t.IndexOf($needle)
if($idx -lt 0){
  Fail "Could not locate stepper call after replacement. Expected to find: $needle"
}
$lineEnd = $t.IndexOf("`n", $idx)
if($lineEnd -lt 0){ $lineEnd = $t.Length }

$banner = @'
              {/* ===== PHASE P5: Debug status banner (UI-only) ===== */}
              {(() => {
                const dbg = p5GetDebugStatus();
                if (!dbg) return null;
                return (
                  <div className="mt-2 rounded-xl border border-purple-200 bg-purple-50 p-2 text-xs">
                    <span className="font-semibold">Debug preview:</span>
                    <span className="font-mono">{" "}{dbg}</span>
                    <span className="opacity-70">{" "} (remove ?debug_status=... to disable)</span>
                  </div>
                );
              })()}
              {/* ===== END PHASE P5 BANNER ===== */}

'@

$t = $t.Substring(0, $lineEnd+1) + $banner + $t.Substring($lineEnd+1)

# Write file
Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
