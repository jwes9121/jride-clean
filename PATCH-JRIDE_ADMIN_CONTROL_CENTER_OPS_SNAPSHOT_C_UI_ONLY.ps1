# PATCH-JRIDE_ADMIN_CONTROL_CENTER_OPS_SNAPSHOT_C_UI_ONLY.ps1
# UI-ONLY: Adds "Ops Snapshot" cards using existing verificationCounts (no new queries)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8

$anchor = "{/* ===== END VERIFICATION LINKS ===== */}"
if ($txt.IndexOf($anchor) -lt 0) {
  Fail "Anchor not found: $anchor"
}

$insert = @'
      {/* ===== OPS SNAPSHOT (PHASE C / UI ONLY) ===== */}
      <section className="mb-4 rounded-2xl border border-black/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Ops Snapshot</div>
            <div className="text-xs opacity-70">At-a-glance queue counts (read-only)</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-xs opacity-70">Pending passenger verifications</div>
            <div className="mt-1 text-lg font-bold">{verificationCounts.admin}</div>
            <div className="mt-1 text-[11px] opacity-70">Admin queue: pending + dispatcher pre-approved</div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-xs opacity-70">Pending dispatcher queue</div>
            <div className="mt-1 text-lg font-bold">{verificationCounts.dispatcher}</div>
            <div className="mt-1 text-[11px] opacity-70">Dispatcher queue: pending only</div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-xs opacity-70">Total pending</div>
            <div className="mt-1 text-lg font-bold">{verificationCounts.admin + verificationCounts.dispatcher}</div>
            <div className="mt-1 text-[11px] opacity-70">Combined queues (display-only)</div>
          </div>
        </div>

        <div className="mt-2 text-[11px] opacity-70">
          UI-only dashboard. No new API routes. No business logic. Read-only counters only.
        </div>
      </section>
      {/* ===== END OPS SNAPSHOT ===== */}
'@

# Insert immediately AFTER the anchor comment
$replacement = $anchor + "`r`n" + $insert
$txt2 = $txt.Replace($anchor, $replacement)

if ($txt2 -eq $txt) { Fail "Patch produced no changes (unexpected)." }

Set-Content -Path $target -Value $txt2 -Encoding utf8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Next:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  feat(admin-control-center): ops snapshot cards (UI only)"
Write-Host "  JRIDE_ADMIN_CONTROL_CENTER_OPS_SNAPSHOT_C_GREEN"
