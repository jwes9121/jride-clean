# PATCH-JRIDE_PHASE5A_VENDOR_PAYOUTS_SAFE_NO_WALLET_MUTATION.ps1
# Creates Vendor Payout Request endpoint + Admin Vendor Payouts endpoint + Admin Vendor Payouts UI
# LOCKED: NO wallet mutations, NO vendor_wallet_transactions writes, NO settle_vendor_wallet RPC, NO schema changes.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Backup-IfExists($path) {
  if (Test-Path -LiteralPath $path) {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $bak = "$path.bak.$ts"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    Ok "[OK] Backup: $bak"
  }
}

function Ensure-Dir($dir) {
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
    Ok "[OK] Created dir: $dir"
  }
}

# --- Targets ---
$apiVendorDir = Join-Path $root "app\api\vendor\payout-request"
$apiAdminDir  = Join-Path $root "app\api\admin\vendor-payouts"
$uiDir         = Join-Path $root "app\admin\vendor-payouts"

$apiVendorFile = Join-Path $apiVendorDir "route.ts"
$apiAdminFile  = Join-Path $apiAdminDir  "route.ts"
$uiFile        = Join-Path $uiDir        "page.tsx"

# --- Ensure dirs ---
Ensure-Dir $apiVendorDir
Ensure-Dir $apiAdminDir
Ensure-Dir $uiDir

# --- Backup existing files if any ---
Backup-IfExists $apiVendorFile
Backup-IfExists $apiAdminFile
Backup-IfExists $uiFile

# ============================================================
# 1) app/api/vendor/payout-request/route.ts  (SAFE: creates vendor payout request record only)
# ============================================================
$vendorPayoutRequestTs = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}
function s(v: any) { return String(v ?? "").trim(); }
function n(v: any) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function minPayout() {
  const v = n(process.env.VENDOR_PAYOUT_MIN);
  return v > 0 ? v : 250;
}

// DIAGNOSTIC GET: proves route exists + deployed
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return json(200, {
    ok: true,
    route: "/api/vendor/payout-request",
    methods: ["GET", "POST"],
    hint_get: "GET ?vendor_id=UUID&limit=20",
    hint_post: "POST { vendor_id, requested_amount, note? }",
    echo: {
      vendor_id: searchParams.get("vendor_id"),
      limit: searchParams.get("limit"),
    },
    min_payout_default: 250,
    min_payout_env: process.env.VENDOR_PAYOUT_MIN ?? null,
    locked_rules: {
      wallet_mutations: false,
      writes_vendor_wallet_transactions: false,
      schema_changes: false,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = await req.json().catch(() => ({} as any));
    const vendor_id = s(body.vendor_id);

    if (!vendor_id || vendor_id.toUpperCase().includes("REPLACE_VENDOR_UUID") || vendor_id.toLowerCase() === "your_vendor_uuid") {
      return json(400, { ok: false, code: "BAD_VENDOR_ID", message: "Provide a real vendor_id UUID." });
    }

    const requested_amount = n(body.requested_amount ?? body.amount);
    const note = s(body.note);

    if (!(requested_amount > 0)) return json(400, { ok: false, code: "BAD_AMOUNT" });

    const min = minPayout();
    if (requested_amount < min) return json(400, { ok: false, code: "BELOW_MIN", min_payout: min });

    // Read-only balance check (NO mutations)
    const { data: balRow, error: balErr } = await admin
      .from("vendor_wallet_balances_v1")
      .select("balance")
      .eq("vendor_id", vendor_id)
      .maybeSingle();

    if (balErr) return json(500, { ok: false, code: "DB_ERROR", stage: "balance", message: balErr.message });

    const balance = n((balRow as any)?.balance);
    if (requested_amount > balance) {
      return json(400, { ok: false, code: "INSUFFICIENT_BALANCE", balance, requested: requested_amount });
    }

    const nowIso = new Date().toISOString();

    // Insert payout request record ONLY (NO wallet tx)
    const { data: ins, error: insErr } = await admin
      .from("vendor_payout_requests")
      .insert({
        vendor_id,
        requested_amount,
        status: "pending",
        note: note || null,
        created_at: nowIso,
        reviewed_at: null,
        reviewed_by: null,
      })
      .select("*")
      .maybeSingle();

    if (insErr) return json(500, { ok: false, code: "DB_ERROR", stage: "insert", message: insErr.message });

    return json(200, { ok: true, request: ins, balance_at_request_time: balance, min_payout: min });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}
'@

[System.IO.File]::WriteAllText($apiVendorFile, $vendorPayoutRequestTs, $utf8NoBom)
Ok "[OK] Wrote: $apiVendorFile"

# ============================================================
# 2) app/api/admin/vendor-payouts/route.ts  (SAFE: list + mark_paid only; NO wallet mutations)
#    NOTE: This REPLACES any prior admin vendor payout route that called settle_vendor_wallet/RPC.
# ============================================================
$adminVendorPayoutsTs = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error("Missing env var: " + name);
  return v;
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}

async function restGetOneById(SUPABASE_URL: string, SERVICE_ROLE: string, id: string) {
  const qs = new URLSearchParams();
  qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");
  qs.set("id", "eq." + id);
  qs.set("limit", "1");

  const url = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let arr: any[] = [];
  try { arr = JSON.parse(text || "[]"); } catch { arr = []; }
  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
  return { ok: true, row };
}

async function restPatchById(SUPABASE_URL: string, SERVICE_ROLE: string, id: string, patch: Record<string, any>) {
  const qs = new URLSearchParams();
  qs.set("id", "eq." + id);
  qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");

  const url = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let out: any[] = [];
  try { out = JSON.parse(text || "[]"); } catch { out = []; }
  return { ok: true, row: Array.isArray(out) && out.length ? out[0] : null };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending").toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const qs = new URLSearchParams();
    qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");
    qs.set("order", "created_at.desc");
    qs.set("limit", String(limit));
    if (status && status !== "all") qs.set("status", "eq." + status);

    const restUrl = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
    const res = await fetch(restUrl, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: text }, { status: res.status });

    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

type ActionReq = {
  id?: string | null;
  action?: "mark_paid" | string | null;
  reviewed_by?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ActionReq;

    const idRaw = body?.id;
    const action = String(body?.action || "").trim().toLowerCase();

    if (!idRaw) return jsonErr("BAD_REQUEST", "Missing id", 400);
    if (!action) return jsonErr("BAD_REQUEST", "Missing action", 400);

    if (action !== "mark_paid") {
      return jsonErr("BAD_REQUEST", "Invalid action (mark_paid only)", 400, { action });
    }

    const id = String(idRaw);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const cur = await restGetOneById(SUPABASE_URL, SERVICE_ROLE, id);
    if (!cur.ok) return jsonErr("DB_ERROR", cur.text || "Failed to load vendor payout request", 500);
    if (!cur.row) return jsonErr("NOT_FOUND", "Vendor payout request not found", 404, { id });

    const currentStatus = String(cur.row.status || "").toLowerCase();

    // If already paid, idempotent success
    if (currentStatus === "paid") {
      return jsonOk({ ok: true, changed: false, idempotent: true, id, status: currentStatus, row: cur.row });
    }

    // Only allow pending -> paid (safest, avoids unknown status constraints)
    if (currentStatus !== "pending") {
      return jsonErr("INVALID_STATE", "Cannot mark_paid when status is " + currentStatus, 409, {
        id,
        current_status: currentStatus,
        target_status: "paid",
      });
    }

    // IMPORTANT: NO wallet mutations. Only update payout request row fields.
    const patch: any = {
      status: "paid",
      reviewed_at: new Date().toISOString(),
      reviewed_by: (body.reviewed_by != null && String(body.reviewed_by).trim().length)
        ? String(body.reviewed_by).trim()
        : "admin",
    };

    const upd = await restPatchById(SUPABASE_URL, SERVICE_ROLE, id, patch);
    if (!upd.ok) return jsonErr("DB_ERROR", upd.text || "Failed to update vendor payout request", 500);

    return jsonOk({ ok: true, changed: true, id, status: "paid", row: upd.row });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || String(e), 500);
  }
}
'@

[System.IO.File]::WriteAllText($apiAdminFile, $adminVendorPayoutsTs, $utf8NoBom)
Ok "[OK] Wrote: $apiAdminFile"

# ============================================================
# 3) app/admin/vendor-payouts/page.tsx  (UI: list + filters + Mark Paid only)
# ============================================================
$vendorUiTsx = @'
"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  vendor_id: string;
  requested_amount: number;
  status: string | null;
  note: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function fmt(ts?: string | null) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 260) return raw.slice(0, 260) + "…";
  return raw;
}

export default function AdminVendorPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [vendorQuery, setVendorQuery] = useState("");

  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [reviewedBy, setReviewedBy] = useState("admin");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/vendor-payouts?status=${status}&limit=200`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to load vendor payouts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function markPaid(id: string) {
    setLoading(true);
    setBanner(null);
    try {
      const body = { id, action: "mark_paid", reviewed_by: reviewedBy || "admin" };
      const res = await fetch("/api/admin/vendor-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.message || data?.error || data?.details || (data?.code ? `DB_ERROR ${data.code}` : "") || "Action failed";
        throw new Error(String(msg));
      }
      setBanner({ kind: "ok", text: `Marked paid for ${id}.` });
      setMarkPaidId(null);
      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.vendor_id || "").toLowerCase().includes(q));
  }, [rows, vendorQuery]);

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

  const bannerStyle = (k: "ok" | "warn" | "err") =>
    ({
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      marginTop: 12,
      background: k === "ok" ? "#ecfdf5" : k === "warn" ? "#fffbeb" : "#fef2f2",
      color: k === "ok" ? "#065f46" : k === "warn" ? "#92400e" : "#991b1b",
      fontSize: 14,
      maxWidth: 980,
      whiteSpace: "pre-wrap",
    } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Vendor Payouts</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label>
          Status:&nbsp;
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="all">all</option>
          </select>
        </label>

        <label>
          Vendor:&nbsp;
          <input
            value={vendorQuery}
            onChange={(e) => setVendorQuery(e.target.value)}
            placeholder="search vendor_id…"
            style={{ width: 260 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} onClick={load} disabled={loading}>Refresh</button>
        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["id","vendor_id","amount","status","created_at","reviewed_at","reviewed_by","note","actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const st = String(r.status || "").toLowerCase();
              const canMarkPaid = st === "pending";
              return (
                <tr key={String(r.id)}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(r.id)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{r.vendor_id}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{Number(r.requested_amount || 0).toFixed(2)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{st}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.created_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.reviewed_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.reviewed_by || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.note || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <button
                      style={!canMarkPaid || loading ? btnDisabled : btn}
                      disabled={!canMarkPaid || loading}
                      onClick={() => { setMarkPaidId(String(r.id)); setReviewedBy("admin"); }}
                      title="pending -> paid (NO wallet mutation)"
                    >
                      Mark Paid
                    </button>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 12, color: "#666" }}>No rows.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {markPaidId ? (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 10, maxWidth: 720 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Mark Paid - {markPaidId}</div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}>
            <div>Reviewed by</div>
            <input value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} placeholder="admin" />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={loading ? btnDisabled : btn} disabled={loading} onClick={() => markPaid(markPaidId)}>Confirm</button>
            <button style={loading ? btnDisabled : btn} disabled={loading} onClick={() => setMarkPaidId(null)}>Cancel</button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            Locked rule: this action updates vendor_payout_requests only. No vendor wallet balance mutations.
          </div>
        </div>
      ) : null}
    </div>
  );
}
'@

[System.IO.File]::WriteAllText($uiFile, $vendorUiTsx, $utf8NoBom)
Ok "[OK] Wrote: $uiFile"

Ok "[DONE] Phase 5A Vendor Payouts created (SAFE, no wallet mutation)."
