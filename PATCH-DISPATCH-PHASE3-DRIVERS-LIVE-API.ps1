# PATCH-DISPATCH-PHASE3-DRIVERS-LIVE-API.ps1
$ErrorActionPreference = "Stop"

$target = "app/api/dispatch/drivers-live/route.ts"

if (Test-Path $target) {
  $bak = "$target.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $target $bak
  Write-Host "[OK] Backup created: $bak" -ForegroundColor Green
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
}

@'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: drivers, error } = await supabase
      .from("drivers")
      .select(`
        id,
        wallet_balance,
        min_wallet_required,
        wallet_locked,
        driver_locations (
          updated_at
        )
      `);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const out: Record<string, any> = {};

    for (const d of drivers || []) {
      out[d.id] = {
        wallet_balance: d.wallet_balance ?? null,
        min_wallet_required: d.min_wallet_required ?? null,
        wallet_locked: Boolean(d.wallet_locked),
        location_updated_at:
          d.driver_locations?.[0]?.updated_at ?? null
      };
    }

    return NextResponse.json({ ok: true, drivers: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@ | Set-Content $target -Encoding UTF8

Write-Host "[OK] Phase 3 drivers-live API written." -ForegroundColor Green
Write-Host "[NEXT] npm.cmd run build" -ForegroundColor Cyan
