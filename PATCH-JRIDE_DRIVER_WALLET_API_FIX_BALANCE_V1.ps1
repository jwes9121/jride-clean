param()

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$root = Resolve-Path "."
$target = Join-Path $root "app\api\driver\wallet\route.ts"

if (!(Test-Path $target)) {
  Fail "Target file not found: $target"
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$target.bak.$ts"
Copy-Item $target $backup -Force

Write-Host "[OK] Backup: $backup"

$txt = Get-Content $target -Raw

# --- Hard replace entire handler with a safe canonical version ---

$new = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driver_id");

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "driver_id is required" },
        { status: 400 }
      );
    }

    // 1) Fetch driver wallet state (SOURCE OF TRUTH)
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    const balance = Number(driver.wallet_balance ?? 0);
    const minRequired = Number(driver.min_wallet_required ?? 0);
    const walletLocked = !!driver.wallet_locked;

    let walletStatus = "OK";
    if (walletLocked) walletStatus = "LOCKED";
    else if (balance < minRequired) walletStatus = "LOW";

    // 2) Fetch last 20 ledger rows (HISTORY ONLY)
    const { data: txs, error: tErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, amount, balance_after, reason, booking_id, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (tErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to fetch transactions" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      balance,
      min_wallet_required: minRequired,
      wallet_locked: walletLocked,
      wallet_status: walletStatus,
      transactions: txs ?? []
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
'@

Set-Content -Path $target -Value $new -Encoding UTF8

Write-Host "[OK] route.ts patched to read wallet from drivers table"

Write-Host ""
Write-Host "================ BUILD ================"
npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Fail "Build failed. Fix errors before continuing."
}

Write-Host ""
Write-Host "================ VERIFY (FAST) ================="
Write-Host "After deploy, open (incognito):"
Write-Host "https://app.jride.net/api/driver/wallet?driver_id=d41bf199-96c6-4022-8a3d-09ab9dbd270f"
Write-Host "You MUST see:"
Write-Host "  balance: 300"
Write-Host "  min_wallet_required: 250"
Write-Host "  wallet_status: OK"
Write-Host ""

Write-Host "================ POST-SCRIPT (RUN THESE) ================="
Write-Host "git status"
Write-Host "git add -A"
Write-Host "git commit -m `"JRIDE: fix driver wallet API to read balance from drivers table`""
Write-Host "git tag JRIDE_DRIVER_WALLET_API_FIX_BALANCE_V1"
Write-Host "git push"
Write-Host "git push --tags"
Write-Host "=========================================================="
