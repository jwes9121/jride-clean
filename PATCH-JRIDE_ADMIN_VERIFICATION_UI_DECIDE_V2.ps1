# PATCH-JRIDE_ADMIN_VERIFICATION_UI_DECIDE_V2.ps1
# Forces admin verification UI + approve/reject API into the repo.
# ASCII only.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp

$adminPage = Join-Path $root "app\admin\verification\page.tsx"
$decideApi = Join-Path $root "app\api\admin\verification\decide\route.ts"

function Backup($p){
  if(Test-Path $p){
    Copy-Item -LiteralPath $p -Destination "$p.bak.$stamp" -Force
    Write-Host "[OK] Backup: $p.bak.$stamp"
  }
}

# ----------------------------
# A) Decide API (service role)
# ----------------------------
$decideDir = Split-Path -Parent $decideApi
if(!(Test-Path $decideDir)){ New-Item -ItemType Directory -Force -Path $decideDir | Out-Null }
Backup $decideApi

$decideTxt = @'
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

export async function POST(req: Request) {
  try {
    const supabase = adminSupabase();
    const body: any = await req.json().catch(() => ({}));

    const passenger_id = String(body?.passenger_id || "").trim();
    const decision = String(body?.decision || "").trim().toLowerCase();
    const admin_notes = String(body?.admin_notes || "").trim();

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "passenger_id required" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "approved" : "rejected";

    // Update verification request row
    const up = await supabase
      .from("passenger_verification_requests")
      .update({
        status: newStatus,
        reviewed_at: now,
        reviewed_by: "admin",
        admin_notes: admin_notes || null,
      })
      .eq("passenger_id", passenger_id)
      .select("*")
      .maybeSingle();

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    // On approve: unlock passenger by updating auth metadata
    if (decision === "approve") {
      const u = await supabase.auth.admin.updateUserById(passenger_id, {
        user_metadata: { verified: true, night_allowed: true },
      });

      if (u.error) {
        return NextResponse.json({
          ok: true,
          request: up.data,
          warning: "Approved, but failed to update user metadata: " + String(u.error.message || "error"),
        });
      }
    }

    return NextResponse.json({ ok: true, request: up.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}
'@

WriteU $decideApi $decideTxt
Write-Host "[OK] Wrote: $decideApi"

# ----------------------------
# B) Admin UI page
# ----------------------------
$adminDir = Split-Path -Parent $adminPage
if(!(Test-Path $adminDir)){ New-Item -ItemType Directory -Force -Path $adminDir | Out-Null }
Backup $adminPage

$adminTxt = @'
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
    setMsg("");
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
      if (j?.warning) {
        setMsg(String(j.warning));
      }
      await load();
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

        {msg ? <div className="mt-3 text-sm text-amber-700">{msg}</div> : null}

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

WriteU $adminPage $adminTxt
Write-Host "[OK] Wrote: $adminPage"

Write-Host ""
Write-Host "[DONE] Files written. Now run: git status"
