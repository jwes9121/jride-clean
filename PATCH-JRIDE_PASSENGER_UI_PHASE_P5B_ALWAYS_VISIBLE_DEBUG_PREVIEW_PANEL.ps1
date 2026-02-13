# PATCH-JRIDE_PASSENGER_UI_PHASE_P5B_ALWAYS_VISIBLE_DEBUG_PREVIEW_PANEL.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES / NO_BOOKING_REQUIRED
# Adds an always-visible debug preview panel near top of /ride when ?debug_status=... is present.
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
function Insert-After-Line($text,$needle,$insert,$label){
  $p = $text.IndexOf($needle)
  if($p -lt 0){ Fail "Anchor not found ($label): $needle" }
  $e = $text.IndexOf("`n",$p)
  if($e -lt 0){ $e = $text.Length }
  return $text.Substring(0,$e+1) + $insert + $text.Substring($e+1)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t0 = Read-Utf8NoBom $target
$t  = $t0

# Idempotency
if($t.IndexOf("PHASE P5B: Always-visible debug preview panel (UI-only)") -ge 0){
  Write-Host "[OK] PHASE P5B already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Require P5 helpers + P1 stepper
if($t.IndexOf("function p5GetDebugStatus") -lt 0){ Fail "Missing p5GetDebugStatus (PHASE P5). Apply P5 first." }
if($t.IndexOf("function p5OverrideStatus") -lt 0){ Fail "Missing p5OverrideStatus (PHASE P5). Apply P5 first." }
if($t.IndexOf("function p1RenderStepper") -lt 0){ Fail "Missing p1RenderStepper (PHASE P1). Expected already present." }

# Insert panel near the top of the page, right after the <h1 ...>Book a Ride</h1> line
$anchor = '<h1 className="text-2xl font-semibold">Book a Ride</h1>'
if($t.IndexOf($anchor) -lt 0){
  # fallback: any Book a Ride h1
  $anchor = ">Book a Ride</h1>"
  if($t.IndexOf($anchor) -lt 0){ Fail "Could not find Book a Ride <h1> anchor." }
}

$panel = @'
          {/* ===== PHASE P5B: Always-visible debug preview panel (UI-only) ===== */}
          {(() => {
            const dbg = (typeof p5GetDebugStatus === "function") ? p5GetDebugStatus() : "";
            if (!dbg) return null;

            const eff = String(dbg || "").trim().toLowerCase();
            const isTerminal = eff === "completed" || eff === "cancelled";

            // TS-strict safe placeholders (no backend / no assumptions)
            const receiptCode: string = "(debug)";
            const driver: string = "";
            const updated: string = "";

            const statusLabel = eff ? (eff.charAt(0).toUpperCase() + eff.slice(1)) : "Unknown";
            const receiptText =
              "JRIDE TRIP RECEIPT\n" +
              ("Code: " + receiptCode + "\n") +
              ("Status: " + statusLabel + "\n") +
              ("Debug: " + dbg + "\n");

            return (
              <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Debug preview</div>
                    <div className="text-xs opacity-80">
                      Showing UI state for <span className="font-mono">debug_status={dbg}</span>
                    </div>
                  </div>
                  <a
                    className="text-xs rounded-lg border border-black/10 bg-white px-2 py-1 hover:bg-black/5"
                    href="/ride"
                    title="Remove debug_status"
                  >
                    Exit debug
                  </a>
                </div>

                <div className="mt-3">
                  {/* Stepper preview (P1) */}
                  {p1RenderStepper(eff)}
                </div>

                {/* Receipt preview (P2B behavior) */}
                {isTerminal ? (
                  <div className="mt-4 rounded-2xl border border-black/10 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Trip receipt</div>
                        <div className="text-xs opacity-70">
                          {eff === "completed" ? "Completed trip summary" : "Cancelled trip summary"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                          onClick={async () => {
                            try {
                              if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(receiptText);
                              }
                            } catch {}
                          }}
                          title="Copy receipt text"
                        >
                          Copy receipt
                        </button>

                        <a
                          className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                          href="/ride"
                          title="Clear debug and start fresh"
                        >
                          Book again
                        </a>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Code</div>
                        <div className="font-mono text-xs">{receiptCode}</div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Status</div>
                        <div className="font-mono text-xs">{eff}</div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Driver</div>
                        <div className="font-mono text-xs">{driver || "(none)"}</div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Last update</div>
                        <div className="font-mono text-xs">{updated || "--"}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs opacity-80">
                    Tip: use <span className="font-mono">completed</span> or <span className="font-mono">cancelled</span> to preview the receipt.
                  </div>
                )}
              </div>
            );
          })()}
          {/* ===== END PHASE P5B ===== */}

'@

$t = Insert-After-Line $t $anchor $panel "Insert debug preview panel under H1"

Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
