# PATCH-JRIDE_CONTROL_CENTER_VERIFICATION_COUNTS_CLIENT_V1.ps1
# Replaces admin control center page with a minimal client version that shows live pending verification counts.
# ASCII only. UTF-8 no BOM. Backup included.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }
function Fail($m){ throw $m }

$root = Get-Location
$stamp = NowStamp
$f = Join-Path $root "app\admin\control-center\page.tsx"
if(!(Test-Path $f)){ Fail "Missing: $f (paste the path if different)" }

Copy-Item $f "$f.bak.$stamp" -Force

$code = @'
"use client";

import * as React from "react";

type Row = { passenger_id: string };

export default function AdminControlCenter() {
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<number>(0);
  const [msg, setMsg] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to load verification counts");
      const rows: Row[] = Array.isArray(j.rows) ? j.rows : [];
      setPending(rows.length);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setPending(0);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Admin Control Center</div>
            <div className="text-sm opacity-70 mt-1">Centralized navigation hub (counts are live).</div>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Refresh
          </button>
        </div>

        {msg ? <div className="mt-4 text-sm text-amber-700">{msg}</div> : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Pending passenger verifications</div>
            <div className="text-3xl font-bold mt-2">{loading ? "-" : pending}</div>
            <div className="text-xs opacity-70 mt-1">Admin queue (pending)</div>
            <div className="mt-3 flex gap-2">
              <a className="rounded-xl bg-black text-white px-4 py-2 font-semibold" href="/admin/verification">Open</a>
              <a className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold" href="/admin/dispatcher-verifications">Dispatcher</a>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Verification pages</div>
            <div className="text-xs opacity-70 mt-2">Use Admin Verification to approve/reject. Dispatcher is read-only for now.</div>
            <div className="mt-3 grid gap-2">
              <a className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold" href="/admin/verification">Passenger Verification (Admin)</a>
              <a className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold" href="/admin/dispatcher-verifications">Passenger Verification (Dispatcher)</a>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Notes</div>
            <div className="text-xs opacity-70 mt-2">
              If counts show 0 but Admin Verification shows rows, the old page was cached/server-rendered.
              This page forces live no-store fetch.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
'@

WriteU $f $code
Write-Host "[OK] Patched: app/admin/control-center/page.tsx"
Write-Host "[OK] Backup: $f.bak.$stamp"
