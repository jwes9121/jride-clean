# PATCH-JRIDE_PHASE10B1_COMPLETE_TRIP_USE_FINALIZE_RPC_FIX.ps1
# Replace complete-trip route to use admin_finalize_trip_and_credit_wallets (single source of truth).
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$repo = (Get-Location).Path
Info "Repo: $repo"

$routes = Get-ChildItem -Path $repo -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue
if (-not $routes -or $routes.Count -eq 0) { Fail "No route.ts found under repo root." }

# Find the route by a stable marker in your existing file
$targets = @()
foreach ($f in $routes) {
  $t = $null
  try { $t = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }
  if ($null -eq $t) { continue }

  # Strong but safe: must contain your marker and reference bookings table
  if ($t -match 'COMPLETE_TRIP_API_START' -and $t -match '\.from\("bookings"\)') {
    $targets = @($targets + $f)
  }
}

if ($targets.Count -eq 0) {
  Fail "Could not find the complete-trip route.ts (looked for COMPLETE_TRIP_API_START + .from(""bookings""))."
}
if ($targets.Count -gt 1) {
  Info "Multiple matches found:"
  $targets | ForEach-Object { Write-Host " - $($_.FullName)" }
  Fail "Ambiguous: more than one complete-trip route.ts matches."
}

$target = $targets[0].FullName
Info "Target: $target"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "Backup: $bak"

$rewrite = @"
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const adminClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function bad(code: string, message: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any) {
  return NextResponse.json(
    { ok: true, ...payload },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function finalizeTripSafe(input: { bookingCode?: string; bookingId?: string }) {
  const rpcName = "admin_finalize_trip_and_credit_wallets";

  const code = (input.bookingCode || "").trim();
  const id = (input.bookingId || "").trim();

  const attempts: any[] = [];

  if (code) {
    attempts.push({ booking_code: code });
    attempts.push({ p_booking_code: code });
    attempts.push({ in_booking_code: code });
    attempts.push({ _booking_code: code });
    attempts.push({ code });
    attempts.push({ bookingCode: code });
  }
  if (id) {
    attempts.push({ booking_id: id });
    attempts.push({ p_booking_id: id });
    attempts.push({ in_booking_id: id });
    attempts.push({ _booking_id: id });
    attempts.push({ id });
    attempts.push({ bookingId: id });
  }

  for (let i = 0; i < attempts.length; i++) {
    const args = attempts[i];
    const { data, error } = await adminClient.rpc(rpcName as any, args);
    if (!error) return { data, usedArgs: args, error: null as any };
  }

  const last = await adminClient.rpc(rpcName as any);
  if (!last.error) return { data: last.data, usedArgs: null, error: null as any };

  return { data: null, usedArgs: null, error: String(last.error?.message || last.error) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingCode = (body?.bookingCode as string | undefined) || undefined;
    const bookingId = (body?.bookingId as string | undefined) || undefined;

    if (!bookingCode && !bookingId) {
      return bad("MISSING_IDENTIFIER", "bookingCode (or bookingId) is required", 400);
    }

    console.log("COMPLETE_TRIP_API_START", { bookingCode: bookingCode || null, bookingId: bookingId || null });

    const res = await finalizeTripSafe({ bookingCode, bookingId });

    if (res.error) {
      console.error("COMPLETE_TRIP_FINALIZE_RPC_ERROR", res.error);
      return bad(
        "COMPLETE_TRIP_FINALIZE_RPC_ERROR",
        "Finalize RPC failed. This route does not directly update bookings.",
        500,
        { details: res.error }
      );
    }

    console.log("COMPLETE_TRIP_FINALIZE_OK", { usedArgs: res.usedArgs || null });
    return ok({ result: res.data, usedArgs: res.usedArgs || null });
  } catch (err: any) {
    console.error("COMPLETE_TRIP_API_CATCH", err);
    return bad("COMPLETE_TRIP_API_CATCH", String(err?.message || err), 500);
  }
}
"@

# ASCII cleanup just in case
$rewrite = $rewrite.Replace([char]0x2013, "-").Replace([char]0x2014, "-")
$rewrite = $rewrite.Replace([char]0x2018, "'").Replace([char]0x2019, "'")
$rewrite = $rewrite.Replace([char]0x201C, '"').Replace([char]0x201D, '"')

Set-Content -LiteralPath $target -Value $rewrite -Encoding UTF8
Ok "Patched complete-trip route to use admin_finalize_trip_and_credit_wallets."
Ok "Done."
