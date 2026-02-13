# PATCH-JRIDE_P6E_APPLY_DRAFT_FARE_ADMIN_ROUTE.ps1
# P6E: Apply Proposed Fare (draft) via NEW admin-only route
# HARD RULES: DO_NOT_TOUCH_DISPATCH_STATUS, NO_DECLARE, ANCHOR_BASED_ONLY

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path

# ------------------------------------------------------------------
# 1) CREATE BACKEND ROUTE
# ------------------------------------------------------------------
$routeDir = Join-Path $root "app\api\admin\livetrips\apply-fare"
$routeFile = Join-Path $routeDir "route.ts"

if (!(Test-Path $routeDir)) {
  New-Item -ItemType Directory -Path $routeDir | Out-Null
}

if (!(Test-Path $routeFile)) {
@'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const booking_code = String(body?.booking_code || "").trim();
    const fare = Number(body?.fare);

    if (!booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_CODE" }, { status: 400 });
    }
    if (!Number.isFinite(fare) || fare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Try verified_fare first, fallback to proposed_fare
    let { error } = await supabase
      .from("bookings")
      .update({ verified_fare: fare })
      .eq("booking_code", booking_code);

    if (error) {
      const retry = await supabase
        .from("bookings")
        .update({ proposed_fare: fare })
        .eq("booking_code", booking_code);

      if (retry.error) {
        return NextResponse.json(
          { ok: false, code: "UPDATE_FAILED", message: retry.error.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@ | Set-Content -Encoding UTF8 -Path $routeFile

  Write-Host "[OK] Created $routeFile"
} else {
  Fail "Route already exists: $routeFile"
}

# ------------------------------------------------------------------
# 2) PATCH UI — ENABLE APPLY DRAFT BUTTON
# ------------------------------------------------------------------
$uiFile = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $uiFile)) { Fail "UI file not found" }

$ui = Get-Content $uiFile -Raw -Encoding UTF8
$bak = "$uiFile.bak.$(Stamp)"
Copy-Item $uiFile $bak -Force
Write-Host "[OK] Backup: $bak"

$anchor = 'Apply Draft is disabled until backend wiring is added.'
if ($ui.IndexOf($anchor) -lt 0) {
  Fail "Apply Draft anchor not found"
}

$ui = $ui -replace `
  'onClick=\{\(\) => setLastAction\("Apply Draft is disabled until backend wiring is added."\)\}\s*disabled=\{true\}',
@'
onClick={async () => {
  if (!selectedTrip) {
    setLastAction("Select a trip first.");
    return;
  }
  const raw = String(proposedFareDraft ?? "").trim();
  const fare = Number(raw);
  if (!raw || !Number.isFinite(fare) || fare <= 0) {
    setLastAction("Invalid draft fare.");
    return;
  }

  try {
    setLastAction("Applying draft fare...");
    const r = await fetch("/api/admin/livetrips/apply-fare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        booking_code: (selectedTrip as any)?.booking_code,
        fare,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.ok) throw new Error(j?.code || "FAILED");
    setLastAction("Draft fare applied.");
    await loadPage();
  } catch (e:any) {
    setLastAction("Apply failed: " + String(e?.message || e));
  }
}}
disabled={false}
'@

Set-Content -Encoding UTF8 -Path $uiFile -Value $ui
Write-Host "[OK] UI Apply Draft enabled"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
