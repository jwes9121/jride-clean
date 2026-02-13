# PATCH-JRIDE_VERIFICATION_REQUEST_UI_V1.ps1
# ASCII-only patch. Creates backups. No mojibake.

$ErrorActionPreference = "Stop"

function NowStamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function Read-Utf8NoBom($p) { [System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding($false))) }
function Write-Utf8NoBom($p, $txt) { [System.IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding($false))) }

$root = Get-Location
$stamp = NowStamp

$passengerPage = Join-Path $root "app\passenger\page.tsx"
$verifyPage    = Join-Path $root "app\verification\page.tsx"
$vreqRoute     = Join-Path $root "app\api\public\passenger\verification\request\route.ts"

if(!(Test-Path $passengerPage)){ throw "Missing: $passengerPage" }

function Backup($p){
  if(Test-Path $p){
    $bak = "$p.bak.$stamp"
    Copy-Item -LiteralPath $p -Destination $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}

Backup $passengerPage
Backup $verifyPage
Backup $vreqRoute

# ------------------------------------------------------------
# A) Create API route: /api/public/passenger/verification/request
# ------------------------------------------------------------
$dir = Split-Path -Parent $vreqRoute
if(!(Test-Path $dir)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }

@'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function normTown(v: any): string {
  const s = String(v || "").trim();
  return s;
}

export async function GET() {
  const supabase = createClient();
  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;
  if (!user) return NextResponse.json({ ok: true, authed: false }, { status: 200 });

  const passenger_id = user.id;

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      passenger_id,
      request: (!r.error && r.data) ? r.data : null,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const passenger_id = user.id;
  const body: any = await req.json().catch(() => ({}));

  const full_name = String(body?.full_name || "").trim();
  const town = normTown(body?.town);

  if (!full_name) {
    return NextResponse.json({ ok: false, error: "Full name is required" }, { status: 400 });
  }
  if (!town) {
    return NextResponse.json({ ok: false, error: "Town is required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Upsert: passenger can resubmit
  const up = await supabase
    .from("passenger_verification_requests")
    .upsert(
      {
        passenger_id,
        full_name,
        town,
        status: "pending",
        submitted_at: now,
      },
      { onConflict: "passenger_id" }
    )
    .select("*")
    .single();

  if (up.error) {
    return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, request: up.data }, { status: 200 });
}
'@ | Set-Content -LiteralPath $vreqRoute -Encoding UTF8

Write-Host "[OK] Wrote: app/api/public/passenger/verification/request/route.ts"

# ------------------------------------------------------------
# B) Create /verification page (UI)
# ------------------------------------------------------------
$dir2 = Split-Path -Parent $verifyPage
if(!(Test-Path $dir2)){ New-Item -ItemType Directory -Force -Path $dir2 | Out-Null }

@'
"use client";

import React from "react";
import { useRouter } from "next/navigation";

type VReq = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: "draft" | "pending" | "approved" | "rejected" | string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  admin_notes?: string | null;
};

export default function VerificationPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string>("");
  const [reqRow, setReqRow] = React.useState<VReq | null>(null);

  const [fullName, setFullName] = React.useState("");
  const [town, setTown] = React.useState("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/public/passenger/verification/request", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!j?.authed) {
        setMsg("Please sign in first.");
        setReqRow(null);
        return;
      }
      const row: VReq | null = j?.request || null;
      setReqRow(row);
      if (row?.full_name) setFullName(String(row.full_name));
      if (row?.town) setTown(String(row.town));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load verification status.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/public/passenger/verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, town }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Submit failed.");
        return;
      }
      setReqRow(j.request || null);
      setMsg("Submitted. Status: pending. Please wait for admin approval.");
    } catch (e: any) {
      setMsg(e?.message || "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  const status = String(reqRow?.status || "");
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isRejected = status === "rejected";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold">Passenger Verification</div>
            <div className="text-sm opacity-70 mt-1">
              Verification is required to unlock night booking (8PM-5AM) and free ride promo.
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Back
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-black/5 p-3 text-sm">
          {loading ? (
            <div>Loading...</div>
          ) : (
            <>
              <div className="font-semibold">Status: {status || "none"}</div>
              {isPending ? (
                <div className="opacity-80 mt-1">Your request is pending approval.</div>
              ) : null}
              {isApproved ? (
                <div className="opacity-80 mt-1">Approved. Return to dashboard.</div>
              ) : null}
              {isRejected ? (
                <div className="opacity-80 mt-1">Rejected. You may update and resubmit.</div>
              ) : null}
              {reqRow?.admin_notes ? (
                <div className="opacity-80 mt-2">Notes: {String(reqRow.admin_notes)}</div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-5 grid gap-3">
          <label className="text-sm font-semibold">
            Full name
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name"
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2"
            />
          </label>

          <label className="text-sm font-semibold">
            Town (pilot)
            <select
              value={town}
              onChange={(e) => setTown(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2"
            >
              <option value="">Select town</option>
              <option value="Lagawe">Lagawe</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className={
              "rounded-xl px-4 py-2 font-semibold text-white " +
              (saving ? "bg-blue-600/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {saving ? "Submitting..." : "Submit for verification"}
          </button>

          {msg ? <div className="text-sm text-amber-700">{msg}</div> : null}
        </div>
      </div>
    </main>
  );
}
'@ | Set-Content -LiteralPath $verifyPage -Encoding UTF8

Write-Host "[OK] Wrote: app/verification/page.tsx"

# ------------------------------------------------------------
# C) Patch passenger dashboard to show pending status (small, safe)
# ------------------------------------------------------------
$txt = Read-Utf8NoBom $passengerPage

if($txt -notmatch "verification/request"){
  # Add fetch to verification request inside existing session loader where we fetch free-ride
  $txt = $txt -replace "try \{\s*if \(\!\!j\?\.\authed\) \{", @'
try {
          if (!!j?.authed) {
            // Verification request status (pending/approved/rejected)
            try {
              const vr = await fetch("/api/public/passenger/verification/request", { cache: "no-store" });
              const vj: any = await vr.json().catch(() => ({}));
              const st = String(vj?.request?.status || "");
              if (!j?.user?.verified && st === "pending") {
                setFreeRideMsg("Verification request is pending. Wait for approval to unlock night booking and free ride promo.");
              }
            } catch {}
'@
}

Write-Utf8NoBom $passengerPage $txt
Write-Host "[OK] Patched: app/passenger/page.tsx (pending message)"
Write-Host "[DONE] Verification request flow added."
