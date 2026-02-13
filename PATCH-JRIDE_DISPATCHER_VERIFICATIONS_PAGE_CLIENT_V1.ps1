# PATCH-JRIDE_DISPATCHER_VERIFICATIONS_PAGE_CLIENT_V1.ps1
# Makes /admin/dispatcher-verifications a client page that loads /api/admin/verification/pending (no-store).
# Read-only list + link to admin page for decisions.
# ASCII only. UTF-8 no BOM. Backup included.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }
function Fail($m){ throw $m }

$root = Get-Location
$stamp = NowStamp
$f = Join-Path $root "app\admin\dispatcher-verifications\page.tsx"
$dir = Split-Path $f -Parent
if(!(Test-Path $dir)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }
if(Test-Path $f){ Copy-Item $f "$f.bak.$stamp" -Force }

$code = @'
"use client";

import * as React from "react";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
  admin_notes: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function fmt(s: any) {
  try { return new Date(String(s)).toLocaleString(); } catch { return String(s || ""); }
}

export default function DispatcherVerificationsPage() {
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [msg, setMsg] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to load pending");
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Passenger Verification (Dispatcher)</div>
            <div className="text-sm opacity-70 mt-1">
              Read-only queue view. Use Admin Verification to approve/reject for now.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
            >
              Refresh
            </button>
            <a
              href="/admin/verification"
              className="rounded-xl bg-black text-white px-4 py-2 font-semibold"
            >
              Open Admin Verification
            </a>
          </div>
        </div>

        {msg ? <div className="mt-4 text-sm text-amber-700">{msg}</div> : null}

        <div className="mt-6 rounded-2xl border border-black/10 overflow-hidden">
          <div className="px-4 py-3 bg-black/5 text-sm font-semibold">
            {loading ? "Loading..." : ("Pending: " + rows.length)}
          </div>

          {!loading && rows.length === 0 ? (
            <div className="p-4 text-sm">No pending verifications.</div>
          ) : null}

          {rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-black/5">
                <tr>
                  <th className="text-left p-3">Passenger</th>
                  <th className="text-left p-3">Town</th>
                  <th className="text-left p-3">Submitted</th>
                  <th className="text-left p-3">Uploads (paths)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.passenger_id} className="border-t border-black/10">
                    <td className="p-3">
                      <div className="font-semibold">{r.full_name || "(no name)"}</div>
                      <div className="text-xs opacity-70">{r.passenger_id}</div>
                    </td>
                    <td className="p-3">{r.town || ""}</td>
                    <td className="p-3">{fmt(r.submitted_at)}</td>
                    <td className="p-3">
                      <div className="text-xs opacity-80">id: {String(r.id_front_path || "")}</div>
                      <div className="text-xs opacity-80 mt-1">selfie: {String(r.selfie_with_id_path || "")}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </main>
  );
}
'@

WriteU $f $code
Write-Host "[OK] Patched: app/admin/dispatcher-verifications/page.tsx"
if(Test-Path "$f.bak.$stamp"){ Write-Host "[OK] Backup: $f.bak.$stamp" }
