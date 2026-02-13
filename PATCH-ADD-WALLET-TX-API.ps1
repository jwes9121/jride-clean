# PATCH-ADD-WALLET-TX-API.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path $root $rel

New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null

$code = @'
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const kind = (url.searchParams.get("kind") || "").toLowerCase(); // driver | vendor
    const id = url.searchParams.get("id") || "";
    const limitRaw = url.searchParams.get("limit") || "20";
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));

    if (!kind || (kind !== "driver" && kind !== "vendor")) {
      return bad("Missing/invalid kind (driver|vendor)", "BAD_KIND");
    }
    if (!id || !isUuid(id)) return bad("Missing/invalid id (uuid)", "BAD_ID");

    const table = kind === "driver" ? "driver_wallet_transactions" : "vendor_wallet_transactions";
    const key = kind === "driver" ? "driver_id" : "vendor_id";

    // Don't assume columns exist across schemas — select all, limit rows.
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(key, id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return bad("Wallet tx fetch failed", "WALLET_TX_FETCH_FAILED", 500, { details: error.message });
    }

    return ok({ kind, id, rows: data ?? [] });
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
'@

Set-Content -Path $path -Value $code -Encoding UTF8
Write-Host "[OK] Wrote $rel" -ForegroundColor Green

Write-Host "[NEXT] Run: npm run build" -ForegroundColor Cyan
