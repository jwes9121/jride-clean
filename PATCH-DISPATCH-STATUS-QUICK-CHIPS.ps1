# PATCH-DISPATCH-STATUS-QUICK-CHIPS.ps1
# Adds Status Quick Chips for Search V2 (hooks-safe)
# Touches ONLY: app\dispatch\page.tsx
# Reversible via clear marker block.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$target = "app\dispatch\page.tsx"
if (-not (Test-Path $target)) { Fail "Missing file: $target (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

$txt = Get-Content $target -Raw

# Guard: don't double-apply
if ($txt -match "JRIDE_UI_STATUS_FILTER_CHIPS_START") {
  Warn "Marker already present. No changes made."
  exit 0
}

# We insert the chips block inside the existing Quick filters bar:
# Find the Clear button end, then the 'Showing: ...' span.
$needleRx = '(?s)(title="Clear search \+ quick filters"[\s\S]*?</button>\s*)(<span\s+className="text-xs\s+text-slate-500\s+ml-2"\s*>)'
$m = [regex]::Match($txt, $needleRx)
if (-not $m.Success) {
  Fail "Could not find insertion point in Quick filters bar (Clear button -> Showing span). Aborting."
}

$chips = @"
              {/* JRIDE_UI_STATUS_FILTER_CHIPS_START */}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-slate-500 mr-1">Status:</span>

                {[
                  { k: "pending", label: "Pending" },
                  { k: "assigned", label: "Assigned" },
                  { k: "on_the_way", label: "On the way" },
                  { k: "on_trip", label: "On trip" },
                  { k: "completed", label: "Completed" },
                  { k: "cancelled", label: "Cancelled" },
                ].map((it) => {
                  const active = normStatus(qStatus) === it.k;
                  return (
                    <button
                      key={it.k}
                      type="button"
                      onClick={() => setQStatus(it.k)}
                      className={[
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        active ? "bg-slate-200 border-slate-300" : "hover:bg-slate-50",
                      ].join(" ")}
                      title={"Filter status: " + it.k}
                    >
                      {it.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setQStatus("")}
                  className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-slate-50"
                  title="Clear status filter"
                >
                  Clear status
                </button>
              </div>
              {/* JRIDE_UI_STATUS_FILTER_CHIPS_END */}
"@

$txt2 = [regex]::Replace($txt, $needleRx, ('$1' + $chips + '$2'), 1)
if ($txt2 -eq $txt) { Fail "No change produced (unexpected). Aborting." }

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Ok "Patched: $target"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm run build" -ForegroundColor Cyan
Write-Host "2) npm run dev  (verify chips set qStatus and filter table)" -ForegroundColor Cyan
Write-Host "3) git diff (confirm marker block + minimal change)" -ForegroundColor Cyan
