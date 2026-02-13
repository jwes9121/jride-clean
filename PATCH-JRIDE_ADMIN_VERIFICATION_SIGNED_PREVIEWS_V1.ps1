# PATCH-JRIDE_ADMIN_VERIFICATION_SIGNED_PREVIEWS_V1.ps1
# Adds signed URL previews for passenger ID + selfie in Admin pending list.
# Patches:
# - app/api/admin/verification/pending/route.ts
# - app/admin/verification/page.tsx
# ASCII only. Backup included.

$ErrorActionPreference = "Stop"
function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }
function Fail($m){ throw $m }

$root = Get-Location
$stamp = NowStamp

$apiFile = Join-Path $root "app\api\admin\verification\pending\route.ts"
$uiFile  = Join-Path $root "app\admin\verification\page.tsx"

if(!(Test-Path $apiFile)){ Fail "Missing: $apiFile" }
if(!(Test-Path $uiFile)){ Fail "Missing: $uiFile" }

Copy-Item $apiFile "$apiFile.bak.$stamp" -Force
Copy-Item $uiFile  "$uiFile.bak.$stamp" -Force

# --- API: return signed URLs for private buckets ---
$api = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return (v && String(v).trim()) ? String(v).trim() : "";
}

export async function GET() {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const service =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_KEY");

    if (!url) {
      return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
    }
    if (!service) {
      // We can still return rows, but we cannot sign private storage URLs.
      // This keeps the UI functional while you add the env var.
    }

    const supabase = createClient(url, service || (env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY")), {
      auth: { persistSession: false },
    });

    // Pull pending rows
    const { data, error } = await supabase
      .from("passenger_verification_requests")
      .select("passenger_id, full_name, town, status, submitted_at, admin_notes, id_front_path, selfie_with_id_path")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];

    // If no service key, return rows without signed urls
    if (!service) {
      return NextResponse.json({
        ok: true,
        rows: rows.map((r: any) => ({
          ...r,
          id_front_signed_url: null,
          selfie_signed_url: null,
          signed_url_note: "SUPABASE_SERVICE_ROLE_KEY missing, cannot sign private storage urls",
        })),
      });
    }

    // Buckets (private)
    const ID_BUCKET = "passenger-ids";
    const SELFIE_BUCKET = "passenger-selfies";
    const EXPIRES = 60 * 10; // 10 minutes

    // Create signed urls
    const out = [];
    for (const r of rows) {
      let id_front_signed_url: string | null = null;
      let selfie_signed_url: string | null = null;

      const idPath = r?.id_front_path ? String(r.id_front_path) : "";
      const sfPath = r?.selfie_with_id_path ? String(r.selfie_with_id_path) : "";

      if (idPath) {
        const s = await supabase.storage.from(ID_BUCKET).createSignedUrl(idPath, EXPIRES);
        if (!s.error) id_front_signed_url = s.data?.signedUrl || null;
      }
      if (sfPath) {
        const s = await supabase.storage.from(SELFIE_BUCKET).createSignedUrl(sfPath, EXPIRES);
        if (!s.error) selfie_signed_url = s.data?.signedUrl || null;
      }

      out.push({
        ...r,
        id_front_signed_url,
        selfie_signed_url,
      });
    }

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
'@

WriteU $apiFile $api

# --- UI: show thumbnails + open links ---
$ui = @'
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

  id_front_signed_url?: string | null;
  selfie_signed_url?: string | null;

  signed_url_note?: string | null;
};

function fmt(s: any) {
  try { return new Date(String(s)).toLocaleString(); } catch { return String(s || ""); }
}

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [msg, setMsg] = React.useState<string>("");
  const [busyId, setBusyId] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Failed to load pending (HTTP " + r.status + ")"));
      setRows(Array.isArray(j.rows) ? j.rows : []);
      const note = (j.rows && j.rows[0] && j.rows[0].signed_url_note) ? String(j.rows[0].signed_url_note) : "";
      if (note) setMsg(note);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject", admin_notes: string) {
    setMsg("Submitting decision...");
    setBusyId(passenger_id);
    try {
      const r = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passenger_id, decision, admin_notes }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        const err = j?.error || ("Decision failed (HTTP " + r.status + ")");
        throw new Error(err);
      }
      setMsg("OK: " + decision + " saved. Refreshing...");
      await load();
      setMsg("Done.");
      setTimeout(() => setMsg(""), 1200);
    } catch (e: any) {
      setMsg("ERROR: " + (e?.message || "Decision failed"));
    } finally {
      setBusyId("");
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
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
          <div className="mt-4 text-sm rounded-xl border border-black/10 bg-black/5 p-3">{msg}</div>
        ) : null}

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
                  <th className="text-left p-3">Admin notes</th>
                  <th className="text-left p-3">Uploads</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowItem key={r.passenger_id} row={r} busy={busyId === r.passenger_id} onDecide={decide} />
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Thumb({ url, label }: { url: string | null | undefined; label: string }) {
  if (!url) {
    return <div className="text-xs opacity-60">{label}: (no preview)</div>;
  }
  return (
    <div className="mt-2">
      <div className="text-xs opacity-80">{label}:</div>
      <a href={url} target="_blank" rel="noreferrer" className="inline-block mt-1">
        <img
          src={url}
          alt={label}
          className="rounded-lg border border-black/10"
          style={{ width: 160, height: 110, objectFit: "cover" }}
        />
      </a>
      <div className="text-xs mt-1">
        <a href={url} target="_blank" rel="noreferrer" className="underline">Open</a>
      </div>
    </div>
  );
}

function RowItem({
  row,
  busy,
  onDecide,
}: {
  row: Row;
  busy: boolean;
  onDecide: (id: string, d: "approve" | "reject", n: string) => void;
}) {
  const [notes, setNotes] = React.useState<string>(row.admin_notes || "");

  return (
    <tr className="border-t border-black/10 align-top">
      <td className="p-3">
        <div className="font-semibold">{row.full_name || "(no name)"}</div>
        <div className="text-xs opacity-70">{row.passenger_id}</div>
      </td>
      <td className="p-3">{row.town || ""}</td>
      <td className="p-3">{fmt(row.submitted_at)}</td>
      <td className="p-3">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
          className="w-full rounded-xl border border-black/10 px-3 py-2"
        />
      </td>
      <td className="p-3">
        <Thumb url={row.id_front_signed_url} label="Valid ID" />
        <Thumb url={row.selfie_signed_url} label="Selfie with ID" />
        <div className="text-xs opacity-60 mt-2">
          Paths: id={String(row.id_front_path || "")} selfie={String(row.selfie_with_id_path || "")}
        </div>
      </td>
      <td className="p-3">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.passenger_id, "approve", notes)}
            className={"rounded-xl text-white px-4 py-2 font-semibold " + (busy ? "bg-emerald-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500")}
          >
            {busy ? "Working..." : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.passenger_id, "reject", notes)}
            className={"rounded-xl text-white px-4 py-2 font-semibold " + (busy ? "bg-red-300 cursor-not-allowed" : "bg-red-600 hover:bg-red-500")}
          >
            {busy ? "Working..." : "Reject"}
          </button>
        </div>
      </td>
    </tr>
  );
}
'@

WriteU $uiFile $ui

Write-Host "[OK] Patched API pending route to include signed preview urls (private buckets)."
Write-Host "[OK] Patched admin verification UI to display both photos inline."
Write-Host "[OK] Backups:"
Write-Host " - $apiFile.bak.$stamp"
Write-Host " - $uiFile.bak.$stamp"
