# PATCH-JRIDE_ADMIN_WALLET_ADJUST_CASHOUT_AUDIT_UI_V2_2.ps1
# PS5-safe. Writes wallet API routes + patches admin wallet-adjust page UI (cashout + audit viewer).
# V2.2: flexible anchors for audit panel insertion.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function NowStamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Ensure-FileExists([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { throw "Missing file: $path" }
}

function Backup-File([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { return }
  $bak = "$path.bak.$(NowStamp)"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-TextFileUtf8NoBom([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  if ($dir -and !(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $path"
}

function Replace-Once([string]$src, [string]$pattern, [string]$replacement, [string]$label) {
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (!$rx.IsMatch($src)) { throw "Anchor not found for: $label" }
  return $rx.Replace($src, $replacement, 1)
}

function Try-Replace-Once([string]$src, [string]$pattern, [string]$replacement, [string]$label, [ref]$did) {
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($rx.IsMatch($src)) {
    $did.Value = $true
    Write-Host "[OK] Anchor used: $label"
    return $rx.Replace($src, $replacement, 1)
  }
  return $src
}

Write-Host "== JRIDE Patch: Admin Wallet Adjust + Cashout + Audit UI (V2.2 PS5-safe) =="

$repo = (Get-Location).Path
Write-Host "Repo: $repo"

$pagePath  = Join-Path $repo "app\admin\wallet-adjust\page.tsx"
$adjPath   = Join-Path $repo "app\api\wallet\adjust\route.ts"
$txPath    = Join-Path $repo "app\api\wallet\transactions\route.ts"
$auditPath = Join-Path $repo "app\api\wallet\audit\route.ts"

# -----------------------------
# 1) API ROUTES
# -----------------------------

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

type Body =
  | {
      kind: "driver_adjust";
      driver_id: string;
      amount: number;
      reason: string;
      created_by?: string | null;
      method?: string | null;
      external_ref?: string | null;
      request_id?: string | null;
    }
  | {
      kind: "vendor_adjust";
      vendor_id: string;
      amount: number;
      kind2?: string | null;
      note?: string | null;
    };

export async function POST(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as any as Body;

    if (!body || !("kind" in body)) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

    if (body.kind === "vendor_adjust") {
      const vendorId = String((body as any).vendor_id || "").trim();
      const amount = Number((body as any).amount || 0);
      const kind2 = String((body as any).kind2 || "adjustment");
      const note = String((body as any).note || "manual_adjust");

      if (!vendorId) return NextResponse.json({ ok: false, error: "MISSING_VENDOR_ID" }, { status: 400 });
      if (!Number.isFinite(amount) || amount === 0) {
        return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("vendor_wallet_transactions")
        .insert({
          vendor_id: vendorId,
          amount,
          kind: kind2,
          note,
          booking_code: null,
        })
        .select("*")
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, error: "VENDOR_ADJUST_FAILED", message: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, kind: "vendor_adjust", row: (data || [])[0] || null });
    }

    const driverId = String((body as any).driver_id || "").trim();
    const amount = Number((body as any).amount || 0);
    const reason = String((body as any).reason || "").trim();
    const createdBy = String((body as any).created_by || "admin").trim();

    const method = String((body as any).method || "admin").trim();
    const externalRef = ((body as any).external_ref ?? null) ? String((body as any).external_ref).trim() : null;
    const requestId = ((body as any).request_id ?? null) ? String((body as any).request_id).trim() : (globalThis.crypto?.randomUUID?.() ?? null);

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });
    if (!reason) return NextResponse.json({ ok: false, error: "MISSING_REASON" }, { status: 400 });

    try {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
        p_driver_id: driverId,
        p_amount: amount,
        p_reason: reason,
        p_created_by: createdBy,
        p_method: method,
        p_external_ref: externalRef,
        p_request_id: requestId,
      });

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("does not exist") || msg.includes("function")) throw error;
        return NextResponse.json({ ok: false, error: "DRIVER_ADJUST_FAILED", message: error.message }, { status: 500 });
      }

      return NextResponse.json(data ?? { ok: true });
    } catch {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet", {
        p_driver_id: driverId,
        p_amount: amount,
        p_reason: reason,
        p_created_by: createdBy,
      });

      if (error) return NextResponse.json({ ok: false, error: "DRIVER_ADJUST_FAILED", message: error.message }, { status: 500 });
      return NextResponse.json(data ?? { ok: true });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}
'@

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

Backup-File $txPath
Write-TextFileUtf8NoBom $txPath $transactionsRoute

Backup-File $adjPath
Write-TextFileUtf8NoBom $adjPath $adjustRoute

Backup-File $auditPath
Write-TextFileUtf8NoBom $auditPath $auditRoute

# -----------------------------
# 2) PATCH ADMIN PAGE
# -----------------------------
Ensure-FileExists $pagePath
Backup-File $pagePath

$src = Get-Content -LiteralPath $pagePath -Raw
$src = [string]$src

# A) Switch endpoints to /api/wallet/*
$src = $src.Replace('"/api/admin/wallet/adjust"', '"/api/wallet/adjust"')
$src = $src.Replace("'/api/admin/wallet/adjust'", "'/api/wallet/adjust'")
$src = $src.Replace('"/api/admin/wallet/transactions"', '"/api/wallet/transactions"')
$src = $src.Replace("'/api/admin/wallet/transactions'", "'/api/wallet/transactions'")
$src = $src.Replace('"/api/admin/wallet/driver-summary"', '"/api/wallet/transactions"')
$src = $src.Replace("'/api/admin/wallet/driver-summary'", "'/api/wallet/transactions'")

# B) Insert audit state + function after lookupBusy
$src = Replace-Once $src `
  '(const\s+\[lookupBusy,\s*setLookupBusy\]\s*=\s*useState\(false\);\s*)' `
  @'
const [lookupBusy, setLookupBusy] = useState(false);

// ===== Wallet Admin Audit (confirmation / accountability) =====
const [auditRows, setAuditRows] = useState<any>(null);
const [auditBusy, setAuditBusy] = useState(false);

async function runDriverAudit(driver_id: string) {
  setAuditBusy(true);
  setAuditRows(null);
  try {
    const headers: Record<string, string> = {};
    if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();
    const res = await fetch(
      "/api/wallet/audit?driver_id=" + encodeURIComponent(driver_id),
      { headers, cache: "no-store" }
    );
    const data = await res.json();
    setAuditRows(data);
  } catch (e: any) {
    setAuditRows({ ok: false, error: e?.message || String(e) });
  } finally {
    setAuditBusy(false);
  }
}

'@ `
  "insert audit state + runDriverAudit"

# C) Replace reasonMode <select> with one that includes manual_cashout
$src = Replace-Once $src `
  '(<select[\s\S]*?value=\{reasonMode\}[\s\S]*?</select>)' `
  @'
<select
  value={reasonMode}
  onChange={(e) => setReasonMode(e.target.value)}
  className="w-full rounded-lg border border-black/10 px-3 py-2"
>
  <option value="manual_topup">Manual Topup (Admin Credit)</option>
  <option value="manual_cashout">Manual Cashout (GCash payout - deduct load wallet)</option>
  <option value="promo_free_ride_credit">Promo Free Ride Credit</option>
  <option value="correction">Correction</option>
  <option value="payout_adjustment">Payout Adjustment</option>
</select>
'@ `
  "replace reasonMode <select>"

# D) Force cashout negative in submit logic
$src = Replace-Once $src `
  'const\s+amt\s*=\s*toNum\(driverAmount\);\s*' `
  @'
const rawAmt = toNum(driverAmount);
const amt =
  String(reasonMode || "") === "manual_cashout"
    ? -Math.abs(rawAmt || 0)
    : Math.abs(rawAmt || 0);

'@ `
  "force amount sign (cashout negative)"

# E) Add Load Wallet Audit button next to Lookup Driver Wallet button
$src = Replace-Once $src `
  '(\{lookupBusy\s*\?\s*"Looking up\.\.\."\s*:\s*"Lookup Driver Wallet"\}[\s\S]*?</button>\s*</div>)' `
  @'
{lookupBusy ? "Looking up..." : "Lookup Driver Wallet"}
</button>

<button
  type="button"
  disabled={auditBusy || !driverId.trim()}
  onClick={() => runDriverAudit(driverId.trim())}
  className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
>
  {auditBusy ? "Loading audit..." : "Load Wallet Audit"}
</button>
</div>
'@ `
  "add Load Wallet Audit button"

# F) Insert audit panel using flexible anchors
$auditPanel = @'
<div className="mt-4 rounded-xl border border-black/10 p-4 bg-slate-50">
  <div className="font-semibold">Wallet Admin Audit (confirmation / accountability)</div>
  <div className="mt-1 text-xs opacity-60">
    Shows receipt_ref, before/after balance, status, and error_message for topups/cashouts.
  </div>
  <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
    {auditRows ? JSON.stringify(auditRows, null, 2) : "(no audit loaded yet)"}
  </pre>
</div>

'@

$didInsert = $false

# 1) Before a Response header (any div with "Response")
$src = Try-Replace-Once $src `
  '(<div[^>]*>\s*Response\s*</div>)' `
  ($auditPanel + '$1') `
  "audit insert before Response header" `
  ([ref]$didInsert)

# 2) After a Lookup header (any div with "Lookup")
if (-not $didInsert) {
  $src = Try-Replace-Once $src `
    '(<div[^>]*>\s*Lookup\s*</div>)' `
    ('$1' + "`n" + $auditPanel) `
    "audit insert after Lookup header" `
    ([ref]$didInsert)
}

# 3) After "(no lookup yet)" text if present
if (-not $didInsert) {
  $src = Try-Replace-Once $src `
    '(\(no lookup yet\)[\s\S]*?)(</div>)' `
    ('$1' + "`n" + $auditPanel + '$2') `
    "audit insert after (no lookup yet)" `
    ([ref]$didInsert)
}

# 4) After "(no output yet)" text if present
if (-not $didInsert) {
  $src = Try-Replace-Once $src `
    '(\(no output yet\)[\s\S]*?)(</div>)' `
    ('$1' + "`n" + $auditPanel + '$2') `
    "audit insert after (no output yet)" `
    ([ref]$didInsert)
}

if (-not $didInsert) {
  throw "Could not insert audit panel: no suitable anchor found (Response/Lookup/(no lookup yet)/(no output yet))."
}

Write-TextFileUtf8NoBom $pagePath $src

Write-Host "== DONE =="
Write-Host "Next: npm.cmd run build, then open /admin/wallet-adjust and test Topup + Cashout + Audit."
