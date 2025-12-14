param()

function Fail($m){ throw $m }
function EnsureDir($p){ if(-not (Test-Path $p)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function BackupFile($p){
  if(Test-Path $p){
    $bak = "$p.bak_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    Copy-Item $p $bak -Force
    Write-Host "🧷 Backup: $bak" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "JRide Payout UX Best-Practice Patch (NO MANUAL EDITS)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

if(-not (Test-Path $repo)){ Fail "Repo not found: $repo" }
Set-Location $repo

# -----------------------------
# 1) OVERWRITE Admin Reports Page
# -----------------------------
$reportsPath = Join-Path $repo "app\admin\payouts\drivers\reports\page.tsx"
EnsureDir (Split-Path $reportsPath -Parent)
BackupFile $reportsPath

$reportsContent = @"
'use client';

import { useMemo, useState } from 'react';

type AutoApproveResult = {
  run_id?: number;
  rule_enabled?: boolean;
  checked_count?: number;
  approved_count?: number;
  skipped_insufficient?: number;
  skipped_other?: number;
};

function fmt(n: any) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function normalizeAutoApprove(payload: any): AutoApproveResult {
  // Accept shapes:
  // 1) { ok:true, result:[{...}] }
  // 2) { ok:true, result:{...} }
  // 3) direct [{...}]
  // 4) direct {...}
  const raw =
    Array.isArray(payload?.result) ? payload.result[0] :
    payload?.result ? payload.result :
    Array.isArray(payload) ? payload[0] :
    payload;

  return {
    run_id: raw?.run_id,
    rule_enabled: raw?.rule_enabled,
    checked_count: fmt(raw?.checked_count),
    approved_count: fmt(raw?.approved_count),
    skipped_insufficient: fmt(raw?.skipped_insufficient),
    skipped_other: fmt(raw?.skipped_other),
  };
}

function bannerFrom(r: AutoApproveResult) {
  const checked = fmt(r.checked_count);
  const approved = fmt(r.approved_count);
  const skippedIns = fmt(r.skipped_insufficient);
  const skippedOther = fmt(r.skipped_other);

  if (checked === 0) {
    return { tone: 'ok', title: 'Nothing to auto-approve', msg: 'No pending payouts.' };
  }
  if (approved > 0) {
    return { tone: 'ok', title: 'Auto-approve complete', msg: \`Approved \${approved} payout(s).\` };
  }
  if (skippedIns > 0) {
    return { tone: 'warn', title: 'No payouts approved', msg: \`Skipped \${skippedIns} payout(s) (insufficient wallet).\` };
  }
  if (skippedOther > 0) {
    return { tone: 'warn', title: 'No payouts approved', msg: \`Skipped \${skippedOther} payout(s) (other reasons).\` };
  }
  return { tone: 'warn', title: 'No payouts approved', msg: 'Nothing met the rules.' };
}

function cls(tone: string) {
  if (tone === 'ok') return 'border border-green-200 bg-green-50 text-green-900';
  if (tone === 'warn') return 'border border-amber-200 bg-amber-50 text-amber-900';
  return 'border border-red-200 bg-red-50 text-red-900';
}

export default function DriverPayoutReportsPage() {
  const today = useMemo(() => new Date(), []);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [from, setFrom] = useState<string>(iso(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState<string>(iso(today));
  const [status, setStatus] = useState<string>('All');
  const [limit, setLimit] = useState<number>(50);

  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: string; title: string; msg: string } | null>(null);
  const [details, setDetails] = useState<any>(null);

  async function runAutoApprove() {
    setBusy(true);
    setBanner(null);
    setDetails(null);

    try {
      const res = await fetch('/api/admin/driver-payouts/auto-approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || json?.error) {
        const msg = json?.error || 'Request failed.';
        setBanner({ tone: 'err', title: 'Auto-approve failed', msg });
        setDetails(json);
        return;
      }

      const r = normalizeAutoApprove(json);
      const b = bannerFrom(r);
      setBanner(b);
      setDetails({ normalized: r, raw: json });

    } catch (e: any) {
      setBanner({ tone: 'err', title: 'Auto-approve failed', msg: e?.message || 'Network error.' });
      setDetails({ error: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    // Keep this URL stable; adjust only if your API differs.
    const qs = new URLSearchParams({
      from,
      to,
      status,
    });
    window.location.href = \`/api/admin/driver-payouts/export?\${qs.toString()}\`;
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Driver Payout Reports</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All</option>
            <option>pending</option>
            <option>paid</option>
            <option>rejected</option>
          </select>
        </label>

        <button
          onClick={exportCsv}
          style={{
            marginLeft: 'auto',
            padding: '10px 16px',
            borderRadius: 10,
            border: '1px solid #111827',
            background: '#111827',
            color: '#fff',
            fontWeight: 700,
          }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 14, padding: 14, maxWidth: 820 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Auto-approve runner</div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value || 0))}
            style={{ width: 90, padding: 8, borderRadius: 10, border: '1px solid #e5e7eb' }}
          />
          <button
            onClick={runAutoApprove}
            disabled={busy}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid #16a34a',
              background: busy ? '#86efac' : '#22c55e',
              color: '#052e16',
              fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Running...' : 'Run auto-approve'}
          </button>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Approves only when rule enabled + wallet stays above minimum.
          </div>
        </div>

        {banner && (
          <div className={cls(banner.tone)} style={{ marginTop: 12, padding: 12, borderRadius: 12 }}>
            <div style={{ fontWeight: 800 }}>{banner.title}</div>
            <div style={{ marginTop: 4 }}>{banner.msg}</div>

            {details && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Details</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>
                  {JSON.stringify(details, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {!banner && (
          <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, opacity: 0.8 }}>
            No run yet.
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Best-practice notes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Show one clean message (no raw JSON) to reduce dispatcher confusion.</li>
            <li>For “insufficient wallet”, show a single phrase: <b>Insufficient wallet</b>.</li>
            <li>Keep technical details behind a “Details” expander for admins only.</li>
          </ul>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
          URL: /admin/payouts/drivers/reports
        </div>
      </div>
    </div>
  );
}
"@

# Write UTF-8 (no BOM)
[System.IO.File]::WriteAllText($reportsPath, $reportsContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "✅ Wrote: $reportsPath" -ForegroundColor Green

# -----------------------------
# 2) PATCH Driver payout request UI (where driver_request_payout is used)
#    Convert scary error -> single clean message
# -----------------------------
Write-Host ""
Write-Host "Scanning for driver_request_payout usage..." -ForegroundColor Cyan

$tsxFiles = Get-ChildItem -Path $repo -Recurse -File -Include *.tsx,*.ts | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\.next\\' }

$targets = @()
foreach($f in $tsxFiles){
  $txt = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  if($null -ne $txt -and $txt -match 'driver_request_payout'){
    $targets += $f.FullName
  }
}

if($targets.Count -eq 0){
  Write-Host "⚠️ No file found containing 'driver_request_payout'. (If your driver payout page uses a different RPC name, tell me.)" -ForegroundColor Yellow
} else {
  foreach($file in $targets){
    BackupFile $file
    $txt = Get-Content $file -Raw

    # Inject helper only if not already present
    if($txt -notmatch 'function\s+friendlyPayoutError'){
      $helper = @"
function friendlyPayoutError(err: any) {
  const msg = String(err?.message || err?.error_description || err || '');
  // Common DB messages
  if (/insufficient wallet/i.test(msg)) return 'Insufficient wallet.';
  if (/minimum/i.test(msg) && /wallet/i.test(msg)) return 'Insufficient wallet.';
  if (/not logged/i.test(msg) || /jwt/i.test(msg)) return 'Please sign in again.';
  return 'Request failed. Please try again.';
}

"@
      # Put helper after 'use client' if present, else at top
      if($txt -match "^[\s]*'use client';"){
        $txt = $txt -replace "^[\s]*'use client';\s*", "'use client';`r`n`r`n$helper"
      } else {
        $txt = $helper + $txt
      }
    }

    # Replace alert/error rendering patterns (best-effort, safe)
    # If you used: alert(JSON.stringify(error))
    $txt = $txt -replace "alert\(\s*JSON\.stringify\([^\)]*\)\s*\)\s*;","alert(friendlyPayoutError(error));"
    # If you used: alert("..."+ something error)
    $txt = $txt -replace "alert\(\s*`"Auto-approve failed:[^`"]*`"\s*\+\s*[^;]+;","alert(friendlyPayoutError(error));"

    # If you used: setError(err.message) pattern, keep but shorten
    $txt = $txt -replace "setError\(\s*([a-zA-Z0-9_\.]+)\.message\s*\)","setError(friendlyPayoutError($1))"

    [System.IO.File]::WriteAllText($file, $txt, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "✅ Patched: $file" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "DONE. Restart dev server if needed: Ctrl+C then npm run dev" -ForegroundColor Green
