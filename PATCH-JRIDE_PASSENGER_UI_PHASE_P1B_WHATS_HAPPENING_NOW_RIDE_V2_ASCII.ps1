# PATCH-JRIDE_PASSENGER_UI_PHASE_P1B_WHATS_HAPPENING_NOW_RIDE_V2_ASCII.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Adds "What's happening now?" messaging under stepper (debug + real trip blocks)
# and fixes mojibake apostrophes in the ride page using ASCII-only script.
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
function Replace-Once($text,$from,$to,$label){
  $i = $text.IndexOf($from)
  if($i -lt 0){ Fail "Anchor not found ($label)." }
  return $text.Substring(0,$i) + $to + $text.Substring($i + $from.Length)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t = Read-Utf8NoBom $target

# Idempotency marker
if($t.IndexOf("PHASE P1B: What's happening now? (UI-only)") -ge 0){
  Write-Host "[OK] PHASE P1B already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# ------------------------------------------------------------
# 1) Mojibake cleanup (ASCII-only)
# Target common UTF-8 mis-decoding sequences for right single quote:
# '  (U+00E2 U+20AC U+2122)  -> '
# ------------------------------------------------------------
$badApos = ([char]0x00E2) + ([char]0x20AC) + ([char]0x2122)
# Replace in the full file (covers We're / You're / can't etc.)
$t = $t -replace [regex]::Escape($badApos), "'"

# Also common mojibake for middle dot in badges etc: "·" (U+00C2 U+00B7) -> "·" or " - "
# We'll normalize to " - " (ASCII safe) if it exists
$badDot = ([char]0x00C2) + ([char]0x00B7)
$t = $t -replace [regex]::Escape($badDot), " - "

# ------------------------------------------------------------
# 2) Insert message UI inside P5B debug panel (under stepper)
# ------------------------------------------------------------
$debugNeedle = "                  {p1RenderStepper(eff)}"
if($t.IndexOf($debugNeedle) -ge 0){
$insertDebug = @'
                  {/* ===== PHASE P1B: What's happening now? (UI-only) ===== */}
                  <div className="mt-2 rounded-xl border border-black/10 bg-white p-2 text-xs">
                    <div className="font-semibold">What's happening now?</div>
                    <div className="mt-1">{p1NowMessage(eff)}</div>
                    {p1WaitHint(eff) ? (
                      <div className="mt-1 opacity-70">{p1WaitHint(eff)}</div>
                    ) : null}
                  </div>
                  {/* ===== END PHASE P1B (DEBUG) ===== */}

'@
  $t = Replace-Once $t $debugNeedle ($debugNeedle + "`n" + $insertDebug) "Insert P1B into debug preview"
} else {
  Write-Host "[WARN] P5B debug stepper anchor not found (skip debug insertion)."
}

# ------------------------------------------------------------
# 3) Insert message UI under the real Trip Status stepper (first occurrence only)
# ------------------------------------------------------------
$realNeedle = "p1RenderStepper(p5OverrideStatus(liveStatus))"
$posReal = $t.IndexOf($realNeedle)
if($posReal -ge 0){
  $lineEnd = $t.IndexOf("`n", $posReal)
  if($lineEnd -lt 0){ $lineEnd = $t.Length }

$insertReal = @'
              {/* ===== PHASE P1B: What's happening now? (UI-only) ===== */}
              {(() => {
                const eff = p5OverrideStatus(liveStatus);
                return (
                  <div className="mt-2 rounded-xl border border-black/10 bg-white p-2 text-xs">
                    <div className="font-semibold">What's happening now?</div>
                    <div className="mt-1">{p1NowMessage(eff)}</div>
                    {p1WaitHint(eff) ? (
                      <div className="mt-1 opacity-70">{p1WaitHint(eff)}</div>
                    ) : null}
                  </div>
                );
              })()}
              {/* ===== END PHASE P1B (REAL) ===== */}

'@
  $t = $t.Substring(0,$lineEnd+1) + $insertReal + $t.Substring($lineEnd+1)
} else {
  Write-Host "[WARN] Real trip stepper anchor not found (skip real insertion)."
}

Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
