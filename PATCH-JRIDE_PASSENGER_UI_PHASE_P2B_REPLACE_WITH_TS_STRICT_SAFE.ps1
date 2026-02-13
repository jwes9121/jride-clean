# PATCH-JRIDE_PASSENGER_UI_PHASE_P2B_REPLACE_WITH_TS_STRICT_SAFE.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Replaces the entire PHASE P2B block with a TS-strict-safe version (no bookingCode, no self-referencing `code`).
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
$t = Read-Utf8NoBom $target

$start = "              {/* ===== PHASE P2B: Trip receipt (debug-aware, UI-only) ===== */}"
$end   = "              {/* ===== END PHASE P2B ===== */}"

$ps = $t.IndexOf($start)
$pe = $t.IndexOf($end)

if($ps -lt 0 -or $pe -lt 0 -or $pe -le $ps){
  Fail "PHASE P2B markers not found (start/end). Cannot replace safely."
}

$peEnd = $pe + $end.Length

# Known-good TS-strict-safe block:
# - uses receiptCode (typed) instead of code
# - no bookingCode / driverId / updatedAt / setResult
$newBlock = @'
              {/* ===== PHASE P2B: Trip receipt (debug-aware, UI-only) ===== */}
              {(() => {
                const eff = String(p5OverrideStatus(liveStatus) || "").trim().toLowerCase();
                const isTerminal = eff === "completed" || eff === "cancelled";
                if (!isTerminal) return null;

                const receiptCode: string =
                  (typeof activeCode !== "undefined" && activeCode) ? String(activeCode) : "(debug)";

                const driver: string =
                  (typeof liveDriverId !== "undefined" && liveDriverId) ? String(liveDriverId) : "";

                const updatedRaw =
                  (typeof liveUpdatedAt !== "undefined" && liveUpdatedAt) ? liveUpdatedAt : null;

                const updated: string = updatedRaw
                  ? (() => { try { return new Date(updatedRaw as any).toLocaleString(); } catch { return String(updatedRaw); } })()
                  : "";

                const statusLabel = eff ? (eff.charAt(0).toUpperCase() + eff.slice(1)) : "Unknown";
                const dbg = (typeof p5GetDebugStatus === "function") ? p5GetDebugStatus() : "";

                const receiptText =
                  "JRIDE TRIP RECEIPT\n" +
                  ("Code: " + receiptCode + "\n") +
                  ("Status: " + statusLabel + "\n") +
                  (driver ? ("Driver: " + driver + "\n") : "") +
                  (updated ? ("Last update: " + updated + "\n") : "") +
                  (dbg ? ("Debug: " + dbg + "\n") : "");

                return (
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

                        <button
                          type="button"
                          className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                          onClick={() => {
                            // UI-only reset: remove debug_status param and reload
                            try {
                              if (typeof window !== "undefined") {
                                const u = new URL(window.location.href);
                                u.searchParams.delete("debug_status");
                                window.location.href = u.toString();
                              }
                            } catch {
                              if (typeof window !== "undefined") window.location.href = "/ride";
                            }
                          }}
                          title="Clear debug preview and start fresh"
                        >
                          Book again
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Code</div>
                        <div className="font-mono text-xs">{receiptCode}</div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Status</div>
                        <div className="font-mono text-xs">{eff || "(unknown)"}</div>
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

                    {dbg ? (
                      <div className="mt-3 text-xs opacity-70">
                        Debug preview active: <span className="font-mono">debug_status={dbg}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
              {/* ===== END PHASE P2B ===== */}
'@

# Safe splice using ORIGINAL indices
$prefix = $t.Substring(0, $ps)
$suffix = $t.Substring($peEnd)
$t2 = $prefix + $newBlock + $suffix

# Sanity checks: ensure we removed the problematic tokens
if($t2.IndexOf("bookingCode") -ge 0){ Write-Host "[WARN] bookingCode still exists somewhere in file (outside P2B block)." }
if($t2.IndexOf("const code") -ge 0){ Write-Host "[WARN] 'const code' still exists somewhere in file (outside P2B block)." }

Write-Utf8NoBom $target $t2
Write-Host "[OK] Replaced PHASE P2B block (TS-strict-safe)"
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
