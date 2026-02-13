# PATCH-JRIDE_PASSENGER_UI_PHASE_P2_TRIP_RECEIPT_UI_ONLY.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Adds a terminal-only receipt card + copy receipt + book again.
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
$t0 = Read-Utf8NoBom $target
$t  = $t0

# Idempotency: if already applied, do nothing
if($t.IndexOf("PHASE P2: Trip receipt (terminal-only, UI-only)") -ge 0){
  Write-Host "[OK] PHASE P2 receipt block already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[OK] Wrote: $target"
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Anchor line in the Trip status (live) enhanced block (we added earlier)
$pollLine = '<div className="mt-2 text-xs opacity-70">Polling: /api/public/passenger/booking?code=...</div>'

if($t.IndexOf($pollLine) -lt 0){
  Fail "Could not locate the Trip status polling line anchor. (Expected the enhanced Trip status block to be present.)"
}

$receiptBlock = @'
              {/* ===== PHASE P2: Trip receipt (terminal-only, UI-only) ===== */}
              {(() => {
                const st = String(liveStatus || "").trim().toLowerCase();
                const isTerminal = st === "completed" || st === "cancelled";
                if (!isTerminal) return null;

                const code = String(activeCode || "").trim();
                const driver = String(liveDriverId || "").trim();
                const updated = liveUpdatedAt ? new Date(liveUpdatedAt).toLocaleString() : "";

                const receiptText =
                  "JRIDE TRIP RECEIPT\n" +
                  (code ? ("Code: " + code + "\n") : "") +
                  ("Status: " + (st ? (st.charAt(0).toUpperCase() + st.slice(1)) : "Unknown") + "\n") +
                  (driver ? ("Driver: " + driver + "\n") : "") +
                  (updated ? ("Last update: " + updated + "\n") : "");

                return (
                  <div className="mt-4 rounded-2xl border border-black/10 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Trip receipt</div>
                        <div className="text-xs opacity-70">
                          {st === "completed" ? "Completed trip summary" : "Cancelled trip summary"}
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
                                setResult("Receipt copied to clipboard.");
                              } else {
                                setResult("Copy not supported on this device/browser.");
                              }
                            } catch {
                              setResult("Copy failed. Please try again.");
                            }
                          }}
                          title="Copy receipt text"
                        >
                          Copy receipt
                        </button>

                        <button
                          type="button"
                          className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                          onClick={() => {
                            // UI-only reset (no backend calls)
                            setActiveCode("");
                            setLiveStatus("");
                            setLiveDriverId("");
                            setLiveUpdatedAt(null);
                            setLiveErr("");
                            setResult("");
                          }}
                          title="Clear receipt and start a new booking"
                        >
                          Book again
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Code</div>
                        <div className="font-mono text-xs">{code || "(none)"}</div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Status</div>
                        <div className="font-mono text-xs">{st || "(unknown)"}</div>
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

                    <div className="mt-3 text-xs opacity-70">
                      Tip: Keep this receipt for reference when reporting issues.
                    </div>
                  </div>
                );
              })()}
              {/* ===== END PHASE P2 ===== */}

'@

# Inject receipt block right after Polling line (still inside the Trip status details container)
$t = Replace-Once $t $pollLine ($pollLine + "`n" + $receiptBlock) "Trip status polling line"

Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "[DONE] PHASE P2 Trip Receipt UI applied."
