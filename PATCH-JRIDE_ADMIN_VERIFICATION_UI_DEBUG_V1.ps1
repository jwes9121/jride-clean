# PATCH-JRIDE_ADMIN_VERIFICATION_UI_DEBUG_V1.ps1
# Makes admin verification UI surface fetch errors + status codes.
# ASCII only.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp
$adminPage = Join-Path $root "app\admin\verification\page.tsx"
if(!(Test-Path $adminPage)){ throw "Missing: $adminPage" }

Copy-Item -LiteralPath $adminPage -Destination "$adminPage.bak.$stamp" -Force
Write-Host "[OK] Backup: $adminPage.bak.$stamp"

$txt = ReadU $adminPage

# Overwrite the file with a debug-visible version (safe + clear)
$txt = @'
"use client";

import React from "react";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
};

type ApiResult = {
  ok?: boolean;
  rows?: any[];
  request?: any;
  error?: string;
  warning?: string;
};

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [msg, setMsg] = React.useState<string>("");
  const [lastStatus, setLastStatus] = React.useState<string>("");
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    setLastStatus("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: ApiResult = await r.json().catch(() => ({}));
      setLastStatus("pending: HTTP " + r.status);

      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Failed to load pending verifications.");
        setRows([]);
        return;
      }

      setRows(Array.isArray(j.rows) ? (j.rows as any) : []);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load pending verifications.");
      setLastStatus("pending: fetch failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject") {
    setBusyId(passenger_id);
    setMsg("");
    setLastStatus("");
    try {
      const r = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passenger_id,
          decision,
          admin_notes: notes[passenger_id] || "",
        }),
      });

      const j: ApiResult = await r.json().catch(() => ({}));
      setLastStatus("decide: HTTP " + r.status);

      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Action failed.");
        return;
      }

      if (j?.warning) setMsg(String(j.warning));
      else setMsg("OK: " + decision);

      await load();
    } catch (e: any) {
      setMsg(e?.message || "Action failed.");
      setLastStatus("decide: fetch failed");
    } finally {
      setBusyId("");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Passenger Verification (Admin)</div>
            <div className="text-sm opacity-70 mt-1">Approve or reject pending passenger verification requests.</div>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Refresh
          </button>
        </div>

        {(msg || lastStatus) ? (
          <div className="mt-3 rounded-xl border border-black/10 bg-black/5 p-3 text-sm">
            {lastStatus ? <div className="opacity-70">Last: {lastStatus}</div> : null}
            {msg ? <div className="text-amber-700 mt-1">{msg}</div> : null}
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-black/10 overflow-hidden">
          {loading ? (
            <div className="p-4">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="p-4">No pending verifications.</div>
          ) : (
            <div className="w-full overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/5">
                  <tr>
                    <th className="text-left p-3">Passenger</th>
                    <th className="text-left p-3">Town</th>
                    <th className="text-left p-3">Submitted</th>
                    <th className="text-left p-3">Admin notes</th>
                    <th className="text-left p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pid = String(r.passenger_id);
                    return (
                      <tr key={pid} className="border-t border-black/10">
                        <td className="p-3">
                          <div className="font-semibold">{r.full_name || "(no name)"}</div>
                          <div className="opacity-70 text-xs break-all">{pid}</div>
                        </td>
                        <td className="p-3">{r.town || "-"}</td>
                        <td className="p-3">
                          <div className="opacity-80">
                            {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-"}
                          </div>
                        </td>
                        <td className="p-3">
                          <input
                            value={notes[pid] || ""}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [pid]: e.target.value }))}
                            placeholder="Optional notes"
                            className="w-full rounded-xl border border-black/10 px-3 py-2"
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === pid}
                              onClick={() => decide(pid, "approve")}
                              className={
                                "rounded-xl px-4 py-2 font-semibold text-white " +
                                (busyId === pid ? "bg-emerald-600/60 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500")
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busyId === pid}
                              onClick={() => decide(pid, "reject")}
                              className={
                                "rounded-xl px-4 py-2 font-semibold text-white " +
                                (busyId === pid ? "bg-rose-600/60 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-500")
                              }
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
'@

WriteU $adminPage $txt
Write-Host "[OK] Patched: app/admin/verification/page.tsx (debug visible)"
