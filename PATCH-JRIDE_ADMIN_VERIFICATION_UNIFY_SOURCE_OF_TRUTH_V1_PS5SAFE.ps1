#requires -Version 5.1
<#
PATCH JRIDE WEB: unify admin verification with passenger_verification_requests
PS5-safe, ASCII-only

What it does:
1) Replaces app/admin/verification/page.tsx
2) Creates:
   - app/api/admin/passenger-verifications/pending/route.ts
   - app/api/admin/passenger-verifications/forward/route.ts
   - app/api/admin/passenger-verifications/decide/route.ts

Source of truth:
- passenger_verification_requests
- passenger-ids bucket
- passenger-selfies bucket
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

function WriteTextUtf8NoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  if (Test-Path -LiteralPath $src) {
    $name = [System.IO.Path]::GetFileName($src)
    $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
    Copy-Item -LiteralPath $src -Destination $dst -Force
    return $dst
  }
  return $null
}

Write-Host "== PATCH JRIDE WEB: unify admin verification source of truth (V1 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

# -------------------------------------------------------------------
# 1) Replace app/admin/verification/page.tsx
# -------------------------------------------------------------------
$adminPage = Join-Path $root "app\admin\verification\page.tsx"
$bak1 = BackupFile $adminPage $bakDir "ADMIN_VERIFICATION_PAGE_V1"
if ($bak1) { Write-Host "[OK] Backup: $bak1" }

EnsureDir (Split-Path $adminPage -Parent)

$adminPageContent = @'
"use client";

import * as React from "react";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes: string | null;

  id_front_path?: string | null;
  selfie_with_id_path?: string | null;

  id_front_signed_url?: string | null;
  selfie_signed_url?: string | null;

  signed_url_note?: string | null;
};

type Payload = {
  ok: boolean;
  error?: string;
  counts?: { submitted?: number; pending_admin?: number };
  rows?: { submitted?: Row[]; pending_admin?: Row[] };
};

function fmt(s: any) {
  try {
    if (!s) return "";
    return new Date(String(s)).toLocaleString();
  } catch {
    return String(s || "");
  }
}

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);

  const [submitted, setSubmitted] = React.useState<Row[]>([]);
  const [pendingAdmin, setPendingAdmin] = React.useState<Row[]>([]);

  const [cSubmitted, setCSubmitted] = React.useState(0);
  const [cPendingAdmin, setCPendingAdmin] = React.useState(0);

  const [msg, setMsg] = React.useState<string>("");
  const [busyId, setBusyId] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/passenger-verifications/pending", {
        cache: "no-store",
        credentials: "include",
      });
      const j: Payload = await r.json().catch(() => ({} as any));

      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Failed to load (HTTP " + r.status + ")"));

      const counts = j.counts || {};
      const rows = j.rows || {};

      const sub = Array.isArray(rows.submitted) ? rows.submitted : [];
      const pad = Array.isArray(rows.pending_admin) ? rows.pending_admin : [];

      setSubmitted(sub);
      setPendingAdmin(pad);

      setCSubmitted(Number(counts.submitted || sub.length || 0));
      setCPendingAdmin(Number(counts.pending_admin || pad.length || 0));

      const note =
        (sub[0] && sub[0].signed_url_note) ||
        (pad[0] && pad[0].signed_url_note) ||
        "";
      if (note) setMsg(String(note));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setSubmitted([]);
      setPendingAdmin([]);
      setCSubmitted(0);
      setCPendingAdmin(0);
    } finally {
      setLoading(false);
    }
  }

  function notifyPendingChanged() {
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("jride_verification");
        bc.postMessage({ type: "pending_changed", at: Date.now() });
        bc.close();
      }
    } catch {}
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("jride_verification_pending_changed", String(Date.now()));
      }
    } catch {}
  }

  async function forward(passenger_id: string, notes: string) {
    setMsg("Forwarding to admin...");
    setBusyId(passenger_id);
    try {
      const r = await fetch("/api/admin/passenger-verifications/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passenger_id, admin_notes: notes }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Forward failed (HTTP " + r.status + ")"));

      setMsg("Forwarded. Refreshing...");
      await load();
      notifyPendingChanged();
      setMsg("Done.");
      setTimeout(() => setMsg(""), 1200);
    } catch (e: any) {
      setMsg("ERROR: " + (e?.message || "Forward failed"));
    } finally {
      setBusyId("");
    }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject", admin_notes: string) {
    setMsg("Submitting decision...");
    setBusyId(passenger_id);
    try {
      const r = await fetch("/api/admin/passenger-verifications/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passenger_id, decision, admin_notes }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Decision failed (HTTP " + r.status + ")"));

      setMsg("OK: " + decision + " saved. Refreshing...");
      await load();
      notifyPendingChanged();
      setMsg("Done.");
      setTimeout(() => setMsg(""), 1200);
    } catch (e: any) {
      setMsg("ERROR: " + (e?.message || "Decision failed"));
    } finally {
      setBusyId("");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Passenger Verification (Admin)</div>
            <div className="text-sm opacity-70 mt-1">
              Dispatcher queue: <b>Submitted</b> → forward to <b>Pending Admin</b> → approve/reject.
              Admin may also approve directly from Submitted (bypass).
            </div>
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

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatCard label="Submitted (Dispatcher queue)" value={loading ? "..." : String(cSubmitted)} />
          <StatCard label="Pending Admin" value={loading ? "..." : String(cPendingAdmin)} />
        </div>

        <QueueTable
          title="Submitted (waiting for dispatcher review)"
          loading={loading}
          rows={submitted}
          busyId={busyId}
          onForward={forward}
          onDecide={decide}
          showForward
        />

        <QueueTable
          title="Pending Admin (dispatcher forwarded)"
          loading={loading}
          rows={pendingAdmin}
          busyId={busyId}
          onForward={forward}
          onDecide={decide}
          showForward={false}
        />
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4">
      <div className="text-sm opacity-70">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Thumb({ url, label }: { url: string | null | undefined; label: string }) {
  if (!url) return <div className="text-xs opacity-60">{label}: (no preview)</div>;
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

function QueueTable({
  title,
  loading,
  rows,
  busyId,
  onForward,
  onDecide,
  showForward,
}: {
  title: string;
  loading: boolean;
  rows: Row[];
  busyId: string;
  onForward: (id: string, notes: string) => void;
  onDecide: (id: string, d: "approve" | "reject", n: string) => void;
  showForward: boolean;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-black/10 overflow-hidden">
      <div className="px-4 py-3 bg-black/5 text-sm font-semibold">
        {loading ? "Loading..." : `${title} - ${rows.length}`}
      </div>

      {!loading && rows.length === 0 ? (
        <div className="p-4 text-sm">No items.</div>
      ) : null}

      {rows.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="bg-black/5">
            <tr>
              <th className="text-left p-3">Passenger</th>
              <th className="text-left p-3">Town</th>
              <th className="text-left p-3">Submitted</th>
              <th className="text-left p-3">Notes</th>
              <th className="text-left p-3">Uploads</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowItem
                key={r.passenger_id}
                row={r}
                busy={busyId === r.passenger_id}
                onForward={onForward}
                onDecide={onDecide}
                showForward={showForward}
              />
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function RowItem({
  row,
  busy,
  onForward,
  onDecide,
  showForward,
}: {
  row: Row;
  busy: boolean;
  onForward: (id: string, notes: string) => void;
  onDecide: (id: string, d: "approve" | "reject", n: string) => void;
  showForward: boolean;
}) {
  const [notes, setNotes] = React.useState<string>(row.admin_notes || "");

  return (
    <tr className="border-t border-black/10 align-top">
      <td className="p-3">
        <div className="font-semibold">{row.full_name || "(no name)"}</div>
        <div className="text-xs opacity-70">{row.passenger_id}</div>
        <div className="text-xs opacity-60 mt-1">Status: {row.status || ""}</div>
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
        <div className="flex flex-wrap gap-2">
          {showForward ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onForward(row.passenger_id, notes)}
              className={
                "rounded-xl text-white px-4 py-2 font-semibold " +
                (busy ? "bg-sky-300 cursor-not-allowed" : "bg-sky-600 hover:bg-sky-500")
              }
            >
              {busy ? "Working..." : "Forward -> Admin"}
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.passenger_id, "approve", notes)}
            className={
              "rounded-xl text-white px-4 py-2 font-semibold " +
              (busy ? "bg-emerald-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500")
            }
          >
            {busy ? "Working..." : "Approve"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row.passenger_id, "reject", notes)}
            className={
              "rounded-xl text-white px-4 py-2 font-semibold " +
              (busy ? "bg-red-300 cursor-not-allowed" : "bg-red-600 hover:bg-red-500")
            }
          >
            {busy ? "Working..." : "Reject"}
          </button>
        </div>
      </td>
    </tr>
  );
}
'@
WriteTextUtf8NoBom $adminPage $adminPageContent
Write-Host "[OK] Replaced: $adminPage"

# -------------------------------------------------------------------
# 2) Create app/api/admin/passenger-verifications/pending/route.ts
# -------------------------------------------------------------------
$pendingRoute = Join-Path $root "app\api\admin\passenger-verifications\pending\route.ts"
$bak2 = BackupFile $pendingRoute $bakDir "ADMIN_VERIFICATION_PENDING_V1"
if ($bak2) { Write-Host "[OK] Backup: $bak2" }
EnsureDir (Split-Path $pendingRoute -Parent)

$pendingContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedUrl(storage: any, bucket: string, path: string | null | undefined) {
  if (!path) return null;
  const r = await storage.from(bucket).createSignedUrl(path, 3600);
  if (r.error || !r.data?.signedUrl) return null;
  return r.data.signedUrl;
}

export async function GET() {
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = adminClient();

    const sub = await admin
      .from("passenger_verification_requests")
      .select("passenger_id,full_name,town,status,submitted_at,reviewed_at,reviewed_by,admin_notes,id_front_path,selfie_with_id_path")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false });

    const pad = await admin
      .from("passenger_verification_requests")
      .select("passenger_id,full_name,town,status,submitted_at,reviewed_at,reviewed_by,admin_notes,id_front_path,selfie_with_id_path")
      .eq("status", "pending_admin")
      .order("submitted_at", { ascending: false });

    if (sub.error) {
      return NextResponse.json({ ok: false, error: sub.error.message }, { status: 500 });
    }
    if (pad.error) {
      return NextResponse.json({ ok: false, error: pad.error.message }, { status: 500 });
    }

    const storage = admin.storage;

    async function enrich(rows: any[]) {
      const out = [];
      for (const r of rows || []) {
        const idUrl = await signedUrl(storage, "passenger-ids", r.id_front_path);
        const selfieUrl = await signedUrl(storage, "passenger-selfies", r.selfie_with_id_path);
        out.push({
          ...r,
          id_front_signed_url: idUrl,
          selfie_signed_url: selfieUrl,
          signed_url_note: "Signed URLs expire after 1 hour.",
        });
      }
      return out;
    }

    const submitted = await enrich(Array.isArray(sub.data) ? sub.data : []);
    const pending_admin = await enrich(Array.isArray(pad.data) ? pad.data : []);

    return NextResponse.json({
      ok: true,
      counts: {
        submitted: submitted.length,
        pending_admin: pending_admin.length,
      },
      rows: {
        submitted,
        pending_admin,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@
WriteTextUtf8NoBom $pendingRoute $pendingContent
Write-Host "[OK] Created: $pendingRoute"

# -------------------------------------------------------------------
# 3) Create app/api/admin/passenger-verifications/forward/route.ts
# -------------------------------------------------------------------
$forwardRoute = Join-Path $root "app\api\admin\passenger-verifications\forward\route.ts"
$bak3 = BackupFile $forwardRoute $bakDir "ADMIN_VERIFICATION_FORWARD_V1"
if ($bak3) { Write-Host "[OK] Backup: $bak3" }
EnsureDir (Split-Path $forwardRoute -Parent)

$forwardContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const passenger_id = body?.passenger_id ? String(body.passenger_id) : "";
    const admin_notes = body?.admin_notes ? String(body.admin_notes) : null;

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "Missing passenger_id" }, { status: 400 });
    }

    const admin = adminClient();
    const upd = await admin
      .from("passenger_verification_requests")
      .update({
        status: "pending_admin",
        admin_notes,
      })
      .eq("passenger_id", passenger_id)
      .eq("status", "submitted")
      .select("*")
      .single();

    if (upd.error) {
      return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: upd.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@
WriteTextUtf8NoBom $forwardRoute $forwardContent
Write-Host "[OK] Created: $forwardRoute"

# -------------------------------------------------------------------
# 4) Create app/api/admin/passenger-verifications/decide/route.ts
# -------------------------------------------------------------------
$decideRoute = Join-Path $root "app\api\admin\passenger-verifications\decide\route.ts"
$bak4 = BackupFile $decideRoute $bakDir "ADMIN_VERIFICATION_DECIDE_V1"
if ($bak4) { Write-Host "[OK] Backup: $bak4" }
EnsureDir (Split-Path $decideRoute -Parent)

$decideContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const passenger_id = body?.passenger_id ? String(body.passenger_id) : "";
    const decision = body?.decision ? String(body.decision) : "";
    const admin_notes = body?.admin_notes ? String(body.admin_notes) : null;

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "Missing passenger_id" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "Invalid decision" }, { status: 400 });
    }

    const nextStatus = decision === "approve" ? "approved" : "rejected";

    const admin = adminClient();
    const upd = await admin
      .from("passenger_verification_requests")
      .update({
        status: nextStatus,
        reviewed_at: nowIso(),
        reviewed_by: user.id,
        admin_notes,
      })
      .eq("passenger_id", passenger_id)
      .in("status", ["submitted", "pending_admin"])
      .select("*")
      .single();

    if (upd.error) {
      return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: upd.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@
WriteTextUtf8NoBom $decideRoute $decideContent
Write-Host "[OK] Created: $decideRoute"

Write-Host ""
Write-Host "== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Files replaced/created:"
Write-Host "  app/admin/verification/page.tsx"
Write-Host "  app/api/admin/passenger-verifications/pending/route.ts"
Write-Host "  app/api/admin/passenger-verifications/forward/route.ts"
Write-Host "  app/api/admin/passenger-verifications/decide/route.ts"