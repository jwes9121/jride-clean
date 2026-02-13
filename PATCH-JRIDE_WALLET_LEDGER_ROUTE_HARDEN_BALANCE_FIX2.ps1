# PATCH-JRIDE_WALLET_LEDGER_ROUTE_HARDEN_BALANCE_FIX2.ps1
# FINAL FIX: avoid $matches collision, PS5-safe, UI untouched.
# Wallet ledger API hardening + optional balance + ASCII safe.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }

$repo = (Get-Location).Path
Info "Repo: $repo"

$candidates = Get-ChildItem -Path $repo -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue
if (-not $candidates -or $candidates.Count -eq 0) {
  Fail "No route.ts files found under repo root."
}

# IMPORTANT: do NOT use variable name 'matches' (reserved by PowerShell)
$walletRoutes = @()

foreach ($f in $candidates) {
  $txt = $null
  try { $txt = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }
  if ($null -eq $txt) { continue }

  if ($txt -match "driver_wallet_transactions" -and
      $txt -match "vendor_wallet_transactions" -and
      $txt -match "WALLET_TX_FETCH_FAILED") {
    $walletRoutes = @($walletRoutes + $f)
  }
}

if ($walletRoutes.Count -eq 0) {
  Fail "Could not find wallet ledger route.ts (driver_wallet_transactions + vendor_wallet_transactions)."
}
if ($walletRoutes.Count -gt 1) {
  Info "Multiple wallet ledger routes found:"
  foreach ($w in $walletRoutes) { Write-Host " - $($w.FullName)" }
  Fail "Ambiguous wallet ledger route. Please remove duplicates."
}

$target = $walletRoutes[0].FullName
Info "Target: $target"

# --- backup ---
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "Backup: $bak"

# --- rewrite file completely (safe + ASCII only) ---
$rewrite = @"
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isNumericId(v: string) {
  return /^[0-9]+$/.test(String(v || "").trim());
}
function isIdOk(v: string) {
  return isUuid(v) || isNumericId(v);
}

async function fetchRowsWithSafeOrdering(table: string, key: string, id: string, limit: number) {
  const orderFields = ["created_at", "updated_at", "inserted_at", "occurred_at", "timestamp", "ts", "id"];

  for (let i = 0; i < orderFields.length; i++) {
    const field = orderFields[i];
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(key, id)
      .order(field as any, { ascending: false })
      .limit(limit);

    if (!error) {
      return { rows: data ?? [], orderedBy: field };
    }

    const msg = String((error as any)?.message || "");
    const isMissingColumn =
      msg.toLowerCase().includes("does not exist") ||
      msg.toLowerCase().includes("unknown column") ||
      (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("not found"));

    if (!isMissingColumn) {
      return { rows: [], orderedBy: null as any, fatalError: msg };
    }
  }

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(key, id)
    .limit(limit);

  if (error) {
    return { rows: [], orderedBy: null as any, fatalError: String((error as any)?.message || error) };
  }
  return { rows: data ?? [], orderedBy: null };
}

async function fetchBalanceSafe(kind: "driver" | "vendor", id: string) {
  const rpcName = kind === "driver"
    ? "admin_get_driver_wallet_balance_v1"
    : "admin_get_vendor_wallet_balance_v1";

  const argSets =
    kind === "driver"
      ? [{ driver_id: id }, { p_driver_id: id }, { in_driver_id: id }, { _driver_id: id }]
      : [{ vendor_id: id }, { p_vendor_id: id }, { in_vendor_id: id }, { _vendor_id: id }];

  for (let i = 0; i < argSets.length; i++) {
    const { data, error } = await supabase.rpc(rpcName as any, argSets[i]);
    if (!error) return { balance: data ?? null, balanceError: null };
  }

  const last = await supabase.rpc(rpcName as any);
  if (!last.error) return { balance: last.data ?? null, balanceError: null };

  return { balance: null, balanceError: String(last.error?.message || last.error) };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const kindRaw = (url.searchParams.get("kind") || "").toLowerCase();
    const kind = kindRaw === "driver" || kindRaw === "vendor" ? kindRaw : null;
    const id = (url.searchParams.get("id") || "").trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));

    if (!kind) return bad("Missing/invalid kind", "BAD_KIND");
    if (!id || !isIdOk(id)) return bad("Missing/invalid id", "BAD_ID");

    const table = kind === "driver" ? "driver_wallet_transactions" : "vendor_wallet_transactions";
    const key = kind === "driver" ? "driver_id" : "vendor_id";

    const res = await fetchRowsWithSafeOrdering(table, key, id, limit);
    if ((res as any).fatalError) {
      return bad("Wallet tx fetch failed", "WALLET_TX_FETCH_FAILED", 500, { details: (res as any).fatalError });
    }

    const bal = await fetchBalanceSafe(kind as any, id);

    return ok({
      kind,
      id,
      orderedBy: res.orderedBy,
      balance: bal.balance,
      balanceError: bal.balanceError,
      rows: res.rows
    });
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
"@

# ASCII cleanup
$rewrite = $rewrite.Replace([char]0x2013, "-").Replace([char]0x2014, "-")
$rewrite = $rewrite.Replace([char]0x2018, "'").Replace([char]0x2019, "'")
$rewrite = $rewrite.Replace([char]0x201C, '"').Replace([char]0x201D, '"')
$rewrite = $rewrite.Replace("-", "--")

Set-Content -LiteralPath $target -Value $rewrite -Encoding UTF8
Ok "Wallet ledger route hardened successfully."
Ok "Done."
