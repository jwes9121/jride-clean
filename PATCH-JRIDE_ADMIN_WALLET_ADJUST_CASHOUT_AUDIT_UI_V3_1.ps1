# PATCH-JRIDE_ADMIN_WALLET_ADJUST_CASHOUT_AUDIT_UI_V3_1.ps1
# JRIDE: Admin Wallet Adjust + Cashout + Audit UI
# V3.1: NO ANCHORS. OVERWRITE target files. PS5-safe.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function NowStamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Backup-IfExists([string]$path) {
  if (Test-Path -LiteralPath $path) {
    $bak = "$path.bak.$(NowStamp)"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $path"
}

Write-Host "== JRIDE Patch: Admin Wallet Adjust + Cashout + Audit UI (V3.1 NO-ANCHOR) ==" -ForegroundColor Cyan
$repo = (Get-Location).Path
Write-Host "Repo: $repo"

$pagePath  = Join-Path $repo "app\admin\wallet-adjust\page.tsx"
$adjPath   = Join-Path $repo "app\api\wallet\adjust\route.ts"
$txPath    = Join-Path $repo "app\api\wallet\transactions\route.ts"
$auditPath = Join-Path $repo "app\api\wallet\audit\route.ts"

# ----------------------------
# 1) app/api/wallet/transactions/route.ts
# ----------------------------
$transactionsRoute = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function requireAdminKey(req: Request) {
  const required = process.env.ADMIN_API_KEY || "";
  if (!required) return { ok: true as const };
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (!got || got !== required) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function shortId(id: string) {
  const s = String(id || "");
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

export async function GET(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const driverId = (url.searchParams.get("driver_id") || "").trim();

    // suggestions by name
    if (q) {
      if (q.length < 2) return NextResponse.json({ ok: true, drivers: [] });

      const { data, error } = await supabase
        .from("drivers")
        .select("id, driver_name")
        .ilike("driver_name", `%${q}%`)
        .limit(20);

      if (error) return NextResponse.json({ ok: false, error: "SUGGEST_FAILED", message: error.message }, { status: 500 });

      const drivers = (data || []).map((d: any) => ({
        id: d.id,
        driver_name: d.driver_name || null,
        label: `${d.driver_name || "Driver"} (${shortId(d.id)})`,
      }));

      return NextResponse.json({ ok: true, drivers });
    }

    // lookup wallet transactions
    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID_OR_Q" }, { status: 400 });

    const { data: drow, error: derr } = await supabase
      .from("drivers")
      .select("id, driver_name, wallet_balance, min_wallet_required, wallet_locked, driver_status")
      .eq("id", driverId)
      .limit(1);

    if (derr) return NextResponse.json({ ok: false, error: "DRIVER_READ_FAILED", message: derr.message }, { status: 500 });

    const driver = (drow || [])[0] || null;

    const { data: txs, error: txErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, created_at, amount, balance_after, reason, booking_id")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (txErr) return NextResponse.json({ ok: false, error: "TX_READ_FAILED", message: txErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, driver, transactions: txs || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}
'@

Backup-IfExists $txPath
Write-Utf8NoBom $txPath $transactionsRoute

# ----------------------------
# 2) app/api/wallet/audit/route.ts
# ----------------------------
$auditRoute = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function requireAdminKey(req: Request) {
  const required = process.env.ADMIN_API_KEY || "";
  if (!required) return { ok: true as const };
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (!got || got !== required) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  return { ok: true as const };
}

export async function GET(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const driverId = (url.searchParams.get("driver_id") || "").trim();
    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });

    const { data, error } = await supabase
      .from("wallet_admin_audit")
      .select("created_at, driver_id, amount, reason, created_by, method, external_ref, receipt_ref, request_id, before_balance, after_balance, status, error_message")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ ok: false, error: "AUDIT_READ_FAILED", message: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}
'@

Backup-IfExists $auditPath
Write-Utf8NoBom $auditPath $auditRoute

# ----------------------------
# 3) app/api/wallet/adjust/route.ts
#    Supports:
#    - manual_topup via admin_adjust_driver_wallet_audited
#    - manual_cashout via admin_driver_cashout_load_wallet (your DB has this)
# ----------------------------
$adjustRoute = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function requireAdminKey(req: Request) {
  const required = process.env.ADMIN_API_KEY || "";
  if (!required) return { ok: true as const };
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (!got || got !== required) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const body = await req.json().catch(() => ({} as any));

    const kind = String(body.kind || "driver_adjust");
    if (kind !== "driver_adjust") {
      return NextResponse.json({ ok: false, error: "ONLY_DRIVER_ADJUST_SUPPORTED" }, { status: 400 });
    }

    const driverId = String(body.driver_id || "").trim();
    const rawAmount = Number(body.amount || 0);
    const reasonMode = String(body.reason_mode || "manual_topup").trim();
    const createdBy = String(body.created_by || "admin").trim();
    const method = String(body.method || "gcash").trim();
    const externalRef = (body.external_ref ?? null) ? String(body.external_ref).trim() : null;
    const requestId = (body.request_id ?? null) ? String(body.request_id).trim() : null;

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!Number.isFinite(rawAmount) || rawAmount === 0) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });

    // CASHOUT path uses DB function you already tested:
    // admin_driver_cashout_load_wallet(p_driver_id uuid, p_cashout_amount numeric, p_created_by text, p_method text, p_external_ref text, p_request_id uuid)
    if (reasonMode === "manual_cashout") {
      const cashoutAmount = Math.abs(rawAmount); // DB function will debit using -amount internally
      const { data, error } = await supabase.rpc("admin_driver_cashout_load_wallet", {
        p_driver_id: driverId,
        p_cashout_amount: cashoutAmount,
        p_created_by: createdBy,
        p_method: method,
        p_external_ref: externalRef,
        p_request_id: requestId,
      });

      if (error) return NextResponse.json({ ok: false, error: "CASHOUT_FAILED", message: error.message }, { status: 500 });
      return NextResponse.json(data ?? { ok: true });
    }

    // TOPUP path (audited)
    const amount = Math.abs(rawAmount);
    const reasonText = String(body.reason || "Manual Topup (Admin Credit)").trim() || "Manual Topup (Admin Credit)";

    const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
      p_driver_id: driverId,
      p_amount: amount,
      p_reason: reasonText,
      p_created_by: createdBy,
      p_method: method,
      p_external_ref: externalRef,
      p_request_id: requestId,
    });

    if (error) return NextResponse.json({ ok: false, error: "TOPUP_FAILED", message: error.message }, { status: 500 });
    return NextResponse.json(data ?? { ok: true });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}
'@

Backup-IfExists $adjPath
Write-Utf8NoBom $adjPath $adjustRoute

# ----------------------------
# 4) app/admin/wallet-adjust/page.tsx
#    FULL overwrite: adds Manual Cashout + Audit panel + uses /api/wallet/* routes
# ----------------------------
$page = @'
"use client";

import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;

function toNum(x: string) {
  const n = Number((x || "").toString().trim());
  return Number.isFinite(n) ? n : 0;
}

export default function WalletAdjustAdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [tab, setTab] = useState<"driver" | "vendor" | "vendor_settle">("driver");

  // driver section
  const [driverQuery, setDriverQuery] = useState("");
  const [driverSuggestions, setDriverSuggestions] = useState<any[]>([]);
  const [driverId, setDriverId] = useState("");
  const [reasonMode, setReasonMode] = useState("manual_topup");
  const [receiptRef, setReceiptRef] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("manual_adjust");
  const [createdBy, setCreatedBy] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookup, setLookup] = useState<AnyObj | null>(null);
  const [resp, setResp] = useState<AnyObj | null>(null);

  // audit panel
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditRows, setAuditRows] = useState<AnyObj | null>(null);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
    return h;
  }, [adminKey]);

  function genReceipt() {
    const d = new Date();
    const yy = d.getFullYear().toString();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const rand = Math.random().toString(16).slice(2, 6);
    const r = `JRIDE-WALLET-${yy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
    setReceiptRef(r);
    if (!externalRef.trim()) setExternalRef(r);
    if (reasonMode === "manual_cashout") {
      setReason("Driver Load Wallet Cashout (Manual Payout)");
    } else if (reasonMode === "manual_topup") {
      setReason("Manual Topup (Admin Credit)");
    } else if (reasonMode === "promo_free_ride_credit") {
      setReason("Promo Free Ride Credit");
    }
  }

  async function suggestDrivers(q: string) {
    setDriverQuery(q);
    if (q.trim().length < 2) {
      setDriverSuggestions([]);
      return;
    }
    try {
      const res = await fetch("/api/wallet/transactions?q=" + encodeURIComponent(q.trim()), { headers: adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}, cache: "no-store" });
      const json = await res.json();
      setDriverSuggestions(json.drivers || []);
    } catch {
      setDriverSuggestions([]);
    }
  }

  async function lookupWallet(id: string) {
    setLookupBusy(true);
    setLookup(null);
    try {
      const h: Record<string, string> = {};
      if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
      const res = await fetch("/api/wallet/transactions?driver_id=" + encodeURIComponent(id), { headers: h, cache: "no-store" });
      const json = await res.json();
      setLookup(json);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }

  async function loadAudit(id: string) {
    setAuditBusy(true);
    setAuditRows(null);
    try {
      const h: Record<string, string> = {};
      if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
      const res = await fetch("/api/wallet/audit?driver_id=" + encodeURIComponent(id), { headers: h, cache: "no-store" });
      const json = await res.json();
      setAuditRows(json);
    } catch (e: any) {
      setAuditRows({ ok: false, error: e?.message || String(e) });
    } finally {
      setAuditBusy(false);
    }
  }

  async function applyDriverAdjust() {
    setBusy(true);
    setResp(null);

    const id = driverId.trim();
    const rawAmt = toNum(amount);

    try {
      const payload: AnyObj = {
        kind: "driver_adjust",
        driver_id: id,
        amount: rawAmt,
        reason_mode: reasonMode,
        reason: reason.trim() || "manual_adjust",
        created_by: createdBy.trim() || "admin",
        method: "gcash",
        external_ref: externalRef.trim() || receiptRef.trim() || null,
        request_id: null,
      };

      const res = await fetch("/api/wallet/adjust", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      setResp(json);
    } catch (e: any) {
      setResp({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6">
      <div className="text-2xl font-semibold">Wallet Adjustments (Admin)</div>
      <div className="text-sm opacity-70 mt-1">Manual driver credit/debit + vendor wallet adjustments and full settle.</div>

      <div className="mt-6 rounded-xl border border-black/10 p-4">
        <div className="text-sm font-semibold">Optional Admin Key</div>
        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2"
          placeholder="x-admin-key (only needed if ADMIN_API_KEY is set)"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
        />
        <div className="mt-2 text-xs opacity-60">
          If your API is open (no ADMIN_API_KEY set), you can leave this blank.
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => setTab("driver")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "driver" ? "bg-black text-white" : "bg-white")}>Driver Adjust</button>
        <button onClick={() => setTab("vendor")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor" ? "bg-black text-white" : "bg-white")}>Vendor Adjust</button>
        <button onClick={() => setTab("vendor_settle")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor_settle" ? "bg-black text-white" : "bg-white")}>Vendor Settle (Full)</button>
      </div>

      {tab === "driver" && (
        <div className="mt-4 rounded-xl border border-black/10 p-4">
          <div className="text-lg font-semibold">Driver wallet credit/debit</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Select Driver (type name or UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder='Type driver name... e.g "Juan"'
                value={driverQuery}
                onChange={(e) => suggestDrivers(e.target.value)}
              />
              <div className="mt-2 text-xs opacity-60">Tip: click a suggestion to auto-fill the Driver ID (UUID).</div>

              {driverSuggestions.length > 0 && (
                <div className="mt-2 rounded-lg border border-black/10 overflow-hidden">
                  {driverSuggestions.map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setDriverId(d.id);
                        setDriverQuery(d.label || d.driver_name || d.id);
                        setDriverSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-black/5 text-sm"
                    >
                      {d.label || d.driver_name || d.id}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Driver ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="driver_id (uuid)"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              />

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs opacity-70 mb-1">Reason Mode</div>
                  <select
                    value={reasonMode}
                    onChange={(e) => setReasonMode(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                  >
                    <option value="manual_topup">Manual Topup (Admin Credit)</option>
                    <option value="manual_cashout">Manual Cashout (GCash payout - deduct load wallet)</option>
                    <option value="promo_free_ride_credit">Promo Free Ride Credit</option>
                    <option value="correction">Correction</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs opacity-70 mb-1">Receipt Reference (read-only)</div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2 bg-black/5"
                    value={receiptRef}
                    readOnly
                    placeholder="(auto-generated when you click Generate)"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={genReceipt}
                className="mt-3 w-full rounded-xl border border-black/10 px-4 py-2"
              >
                Generate Reason + Receipt Ref
              </button>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                    placeholder="amount (e.g. 250 or -100)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                    placeholder="admin"
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                  />
                </div>
              </div>

              <input
                className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="manual_adjust"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />

              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy || !driverId.trim()}
                  onClick={applyDriverAdjust}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
                >
                  {busy ? "Applying..." : "Apply Driver Adjustment"}
                </button>

                <button
                  disabled={lookupBusy || !driverId.trim()}
                  onClick={() => lookupWallet(driverId.trim())}
                  className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
                >
                  {lookupBusy ? "Looking up..." : "Lookup Driver Wallet"}
                </button>

                <button
                  disabled={auditBusy || !driverId.trim()}
                  onClick={() => loadAudit(driverId.trim())}
                  className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
                >
                  {auditBusy ? "Loading audit..." : "Load Wallet Audit"}
                </button>
              </div>

              <div className="mt-2 text-xs opacity-60">
                Uses audited functions where available. Cashout uses admin_driver_cashout_load_wallet (non-negative safety enforced by DB).
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-black/10 p-4">
            <div className="text-lg font-semibold">Lookup</div>
            <div className="text-xs opacity-60 mt-1">Balance + last 20 transactions.</div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {lookup ? JSON.stringify(lookup, null, 2) : "(no lookup yet)"}
            </pre>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 p-4 bg-slate-50">
            <div className="font-semibold">Wallet Admin Audit (confirmation / accountability)</div>
            <div className="mt-1 text-xs opacity-60">
              Shows receipt_ref, before/after balance, status, and error_message for topups/cashouts.
            </div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {auditRows ? JSON.stringify(auditRows, null, 2) : "(no audit loaded yet)"}
            </pre>
          </div>

          <div className="mt-6 rounded-xl border border-black/10 p-4">
            <div className="text-lg font-semibold">Response</div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {resp ? JSON.stringify(resp, null, 2) : "(no output yet)"}
            </pre>
          </div>
        </div>
      )}

      {(tab === "vendor" || tab === "vendor_settle") && (
        <div className="mt-4 rounded-xl border border-black/10 p-4">
          <div className="text-lg font-semibold">Vendor</div>
          <div className="text-sm opacity-70 mt-1">
            Vendor Adjust / Vendor Settle UI is unchanged in this V3.1 rewrite. We can wire it next if you want.
          </div>
        </div>
      )}
    </div>
  );
}
'@

Backup-IfExists $pagePath
Write-Utf8NoBom $pagePath $page

Write-Host "== DONE (V3.1) ==" -ForegroundColor Green
Write-Host "Next: npm.cmd run build"
