# PATCH-JRIDE_ADMIN_VERIFICATION_UI_FEEDBACK_NOCACHE_V1.ps1
# Adds UI feedback + optimistic remove + forces no-cache on pending API.
# ASCII only.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp

$pendingApi = Join-Path $root "app\api\admin\verification\pending\route.ts"
$adminPage  = Join-Path $root "app\admin\verification\page.tsx"

if(!(Test-Path $pendingApi)){ throw "Missing: $pendingApi" }
if(!(Test-Path $adminPage)){ throw "Missing: $adminPage" }

Copy-Item $pendingApi "$pendingApi.bak.$stamp" -Force
Copy-Item $adminPage  "$adminPage.bak.$stamp"  -Force
Write-Host "[OK] Backups created"

# ---- Patch pending API to return no-store headers
$apiTxt = ReadU $pendingApi

if($apiTxt -notmatch "Cache-Control"){
  # simple safe replace: wrap json response with headers
  $apiTxt = $apiTxt -replace 'return NextResponse\.json\(\s*\{\s*ok:\s*true,\s*rows:\s*q\.data\s*\|\|\s*\[\]\s*\}\s*,\s*\{\s*status:\s*200\s*\}\s*\)\s*;','return NextResponse.json({ ok: true, rows: q.data || [] }, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });'
}

# if the exact pattern didn't match, overwrite the whole file safely
if($apiTxt -notmatch "Cache-Control"){
  $apiTxt = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  try {
    const supabase = adminSupabase();

    const q = await supabase
      .from("passenger_verification_requests")
      .select("*")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (q.error) {
      return NextResponse.json(
        { ok: false, error: q.error.message },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      { ok: true, rows: q.data || [] },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || "error") },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
'@
}

WriteU $pendingApi $apiTxt
Write-Host "[OK] Patched pending API: no-store headers"

# ---- Patch admin UI page: show message + optimistic remove
$pageTxt = @'
"use client";

import React from "react";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
};

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [msg, setMsg] = React.useState<string>("");
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Failed to load pending verifications.");
        setRows([]);
        return;
      }
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load pending verifications.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject") {
    setBusyId(passenger_id);
    setMsg("");
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

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Action failed.");
        return;
      }

      // optimistic remove so it never "feels stuck"
      setRows((prev) => prev.filter((x) => String(x.passenger_id) !== String(passenger_id)));

      if (j?.warning) setMsg(String(j.warning));
      else setMsg("OK: " + decision + " for " + passenger_id.slice(0, 8) + "...");

      // reload shortly to confirm server state (avoids cache/stale)
      setTimeout(() => { load(); }, 350);
    } catch (e: any) {
      setMsg(e?.message || "Action failed.");
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

        {msg ? (
          <div className="mt-3 rounded-xl border border-black/10 bg-black/5 p-3 text-sm">
            <div className="text-emerald-700">{msg}</div>
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

WriteU $adminPage $pageTxt
Write-Host "[OK] Patched admin UI: feedback + optimistic remove + reload"
