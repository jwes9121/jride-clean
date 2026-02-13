# PATCH-JRIDE_FREE_RIDE_VERIFY_FLOW_V1.ps1
# ASCII-only patch. Creates backups. No mojibake.

$ErrorActionPreference = "Stop"

function NowStamp() { Get-Date -Format "yyyyMMdd_HHmmss" }

function Read-Utf8NoBom($p) {
  return [System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding($false)))
}
function Write-Utf8NoBom($p, $txt) {
  [System.IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding($false)))
}

$root = Get-Location

$passengerPage = Join-Path $root "app\passenger\page.tsx"
$bookRoute     = Join-Path $root "app\api\public\passenger\book\route.ts"
$statusRoute   = Join-Path $root "app\api\dispatch\status\route.ts"
$freeRideRoute = Join-Path $root "app\api\public\passenger\free-ride\route.ts"

foreach($p in @($passengerPage,$bookRoute,$statusRoute)){
  if(!(Test-Path $p)){ throw "Missing file: $p" }
}

$stamp = NowStamp

function Backup($p){
  $bak = "$p.bak.$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

Backup $passengerPage
Backup $bookRoute
Backup $statusRoute

# ------------------------------------------------------------
# A) Create /api/public/passenger/free-ride route (new file)
# ------------------------------------------------------------
$freeRideDir = Split-Path -Parent $freeRideRoute
if(!(Test-Path $freeRideDir)){ New-Item -ItemType Directory -Force -Path $freeRideDir | Out-Null }

if(!(Test-Path $freeRideRoute)){
@'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function truthy(v: any): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0" && s !== "no";
  }
  return false;
}

export async function GET() {
  const supabase = createClient();

  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;

  if (!user) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = user.id;

  const meta: any = (user as any)?.user_metadata || {};
  const verified =
    truthy(meta?.verified) ||
    truthy(meta?.is_verified) ||
    truthy(meta?.verification_tier) ||
    truthy(meta?.night_allowed);

  const r = await supabase
    .from("passenger_free_ride_audit")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  const row: any = (!r.error && r.data) ? r.data : null;

  // Default amounts (your business rule)
  const discount_php = 35;
  const driver_credit_php = 20;

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      passenger_id,
      verified,
      free_ride: row
        ? {
            status: row.status,
            reason: row.reason || null,
            trip_id: row.trip_id || null,
            driver_id: row.driver_id || null,
            discount_php: row.discount_php ?? discount_php,
            driver_credit_php: row.driver_credit_php ?? driver_credit_php,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
          }
        : {
            status: "none",
            discount_php,
            driver_credit_php,
          },
    },
    { status: 200 }
  );
}
'@ | Set-Content -LiteralPath $freeRideRoute -Encoding UTF8
  Write-Host "[OK] Created: app/api/public/passenger/free-ride/route.ts"
} else {
  Write-Host "[SKIP] Exists: app/api/public/passenger/free-ride/route.ts"
}

# ------------------------------------------------------------
# B) Patch app/passenger/page.tsx (remove Switch Account, add Verify + promo UX)
# ------------------------------------------------------------
$txt = Read-Utf8NoBom $passengerPage

# Ensure imports include useEffect already via React
if($txt -notmatch 'fetch\("/api/public/passenger/free-ride"'){
  # Inject new states and promo fetch after existing states
  $txt = $txt -replace [regex]::Escape('  const [nightAllowed, setNightAllowed] = React.useState(false);'),
@'
  const [nightAllowed, setNightAllowed] = React.useState(false);

  const [freeRideStatus, setFreeRideStatus] = React.useState<string>("unknown");
  const [freeRideMsg, setFreeRideMsg] = React.useState<string>("");
'@

  # After session fetch completes, also fetch free-ride status if authed
  $txt = $txt -replace [regex]::Escape('        setNightAllowed(!!j?.user?.night_allowed);'),
@'
        setNightAllowed(!!j?.user?.night_allowed);

        // Free ride promo status (audit-backed)
        try {
          if (!!j?.authed) {
            const rr = await fetch("/api/public/passenger/free-ride", { cache: "no-store" });
            const jj: any = await rr.json().catch(() => ({}));
            const st = String(jj?.free_ride?.status || jj?.free_ride?.status === 0 ? jj?.free_ride?.status : jj?.free_ride?.status || jj?.free_ride?.status || jj?.free_ride?.status).trim();
            const status = st && st !== "undefined" ? st : String(jj?.free_ride?.status || jj?.free_ride?.status || "none");
            setFreeRideStatus(String(jj?.free_ride?.status || "none"));

            const disc = Number(jj?.free_ride?.discount_php ?? 35);
            if (!jj?.authed) {
              setFreeRideMsg("");
            } else if (!jj?.verified) {
              setFreeRideMsg("Verify your account to unlock the free ride (PHP " + disc + ") and to book from 8PM-5AM.");
            } else {
              const s2 = String(jj?.free_ride?.status || "none");
              if (s2 === "eligible") setFreeRideMsg("You have a free ride (PHP " + disc + "). Use it now.");
              else if (s2 === "used") setFreeRideMsg("Free ride already used.");
              else if (s2 === "forfeited") setFreeRideMsg("Free ride forfeited (booked while unverified).");
              else setFreeRideMsg("Free ride available after verification (first ride only).");
            }
          }
        } catch {
          // ignore
        }
'@
}

# Add verify navigation helper
if($txt -notmatch 'function goVerify\('){
  $txt = $txt -replace [regex]::Escape('  function goBookRide() {'),
@'
  function goVerify() {
    if (!authed) return gotoLogin();
    router.push("/verification");
  }

  function goBookRide() {
'@
}

# Replace the existing unverified block with promo-aware copy + verify button
$txt = $txt -replace [regex]::Escape(
'        {authed && !verified ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
            <div className="font-semibold">Verification may be required (8PM-5AM)</div>
            <div className="opacity-80 text-xs mt-1">
              Verified: {String(verified)} | Night allowed: {String(nightAllowed)}
            </div>
            <div className="opacity-80 text-xs mt-1">
              Next: add Complete Profile / Submit for approval.
            </div>
          </div>
        ) : null}'
),
@'
        {authed ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{verified ? "Account verified" : "Verification required"}</div>
                <div className="opacity-80 text-xs mt-1">
                  Verified: {String(verified)} | Night allowed: {String(nightAllowed)}
                </div>
                <div className="opacity-80 text-xs mt-2">
                  {freeRideMsg || (verified ? "First ride promo status will appear here." : "Verify to unlock night booking and free ride promo.")}
                </div>
              </div>
              <button
                type="button"
                onClick={goVerify}
                disabled={verified}
                className={
                  "rounded-xl px-4 py-2 font-semibold " +
                  (verified ? "bg-black/5 text-black/40 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-500")
                }
              >
                {verified ? "Verified" : "Verify account"}
              </button>
            </div>
          </div>
        ) : null}
'@

# Remove Switch Account button and keep only one primary CTA
# Replace the footer button row with:
# - primary: Continue (or Sign in)
# - secondary: Register link is inside login page; no switch button here
$txt = $txt -replace [regex]::Escape(
'        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => (authed ? router.push("/ride") : gotoLogin())}
            disabled={loading}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (loading ? "bg-blue-600/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {loading ? "Loading..." : authed ? "Continue" : "Sign in to continue"}
          </button>

          <button
            type="button"
            onClick={gotoLogin}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Switch Account
          </button>
        </div>'
),
@'
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => (authed ? router.push("/ride") : gotoLogin())}
            disabled={loading}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (loading ? "bg-blue-600/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {loading ? "Loading..." : authed ? "Continue" : "Sign in to continue"}
          </button>

          {authed && !verified ? (
            <button
              type="button"
              onClick={goVerify}
              className="rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 px-5 py-2 font-semibold"
            >
              Verify now
            </button>
          ) : null}
        </div>
'@

Write-Utf8NoBom $passengerPage $txt
Write-Host "[OK] Patched: app/passenger/page.tsx"

# ------------------------------------------------------------
# C) Patch app/api/public/passenger/book/route.ts (takeout requires verified; promo for rides)
# ------------------------------------------------------------
$txt = Read-Utf8NoBom $bookRoute

# Inject helpers near canBookOrThrow (after canBookOrThrow or before POST)
if($txt -notmatch "FREE_RIDE_PROMO_HELPERS_BEGIN"){
  $ins = @'
/* FREE_RIDE_PROMO_HELPERS_BEGIN */
function frTruthy(v:any): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0" && s !== "no";
  }
  return false;
}

async function frGetUserAndVerified(supabase:any): Promise<{ user:any|null; verified:boolean }> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user || null;
  if (!user) return { user: null, verified: false };

  const meta:any = user.user_metadata || {};
  const verified =
    frTruthy(meta?.verified) ||
    frTruthy(meta?.is_verified) ||
    frTruthy(meta?.verification_tier) ||
    frTruthy(meta?.night_allowed);

  return { user, verified };
}

async function frForfeitIfNeeded(supabase:any, passengerId:string, reason:string) {
  if (!passengerId) return;
  // Only set forfeited if no row exists yet
  const ex = await supabase.from("passenger_free_ride_audit").select("status").eq("passenger_id", passengerId).maybeSingle();
  if (!ex.error && ex.data) return;

  await supabase.from("passenger_free_ride_audit").insert({
    passenger_id: passengerId,
    status: "forfeited",
    reason: reason,
    discount_php: 35,
    driver_credit_php: 20,
    platform_cost_php: 15,
    forfeited_at: new Date().toISOString(),
  });
}

async function frMarkUsedIfEligible(supabase:any, passengerId:string, bookingId:string) {
  if (!passengerId || !bookingId) return;

  const ex = await supabase
    .from("passenger_free_ride_audit")
    .select("*")
    .eq("passenger_id", passengerId)
    .maybeSingle();

  if (!ex.error && ex.data) {
    const st = String(ex.data.status || "");
    if (st === "used" || st === "forfeited") return;
    // eligible -> used
    await supabase.from("passenger_free_ride_audit").update({
      status: "used",
      trip_id: bookingId,
      used_at: new Date().toISOString(),
      reason: ex.data.reason || "verified_first_booking",
      discount_php: ex.data.discount_php ?? 35,
      driver_credit_php: ex.data.driver_credit_php ?? 20,
      platform_cost_php: ex.data.platform_cost_php ?? 15,
    }).eq("passenger_id", passengerId);
    return;
  }

  // No row yet -> create used now (burn on first verified booking to avoid abuse)
  await supabase.from("passenger_free_ride_audit").insert({
    passenger_id: passengerId,
    status: "used",
    reason: "verified_first_booking",
    trip_id: bookingId,
    discount_php: 35,
    driver_credit_php: 20,
    platform_cost_php: 15,
    used_at: new Date().toISOString(),
  });
}
/* FREE_RIDE_PROMO_HELPERS_END */
'@

  $txt = $txt -replace [regex]::Escape("async function getBaseUrlFromHeaders(req: Request) {"),
($ins + "`n" + "async function getBaseUrlFromHeaders(req: Request) {")
}

# Inside POST, after `const isTakeout = ...` inject verified checks and set created_by_user_id if possible
$anchor = "  const isTakeout = isTakeoutReq(body as any);"
if($txt -match [regex]::Escape($anchor) -and $txt -notmatch "FREE_RIDE_PROMO_APPLY_BEGIN"){
  $inject = @'
  const isTakeout = isTakeoutReq(body as any);

  /* FREE_RIDE_PROMO_APPLY_BEGIN */
  const uv = await frGetUserAndVerified(supabase as any);
  const user = uv.user;
  const isVerified = uv.verified;

  // Always attach creator (bookings has created_by_user_id in your schema)
  // If insert fails due to column mismatch, fallback logic already exists below.
  const createdByUserId = user?.id ? String(user.id) : null;

  // TAKEOUT REQUIRES VERIFIED (always, per business rule)
  if (isTakeout && !isVerified) {
    return NextResponse.json(
      { ok: false, code: "TAKEOUT_REQUIRES_VERIFIED", message: "Verify your account to order takeout during pilot." },
      { status: 403 }
    );
  }
  /* FREE_RIDE_PROMO_APPLY_END */
'@
  $txt = $txt -replace [regex]::Escape($anchor), $inject
}

# Add created_by_user_id into payload (first payload creation)
$txt = $txt -replace [regex]::Escape("  const payload: any = {"),
@'
  const payload: any = {
'@

if($txt -notmatch "created_by_user_id"){
  # insert after booking_code line inside payload
  $txt = $txt -replace [regex]::Escape("    booking_code,"),
@'
    booking_code,
    created_by_user_id: createdByUserId,
'@
}

# After successful insert (INS1 path), mark promo used/forfeit depending on verified and takeout
# Insert just after: `let booking: any = ins.data;`
$txt = $txt -replace [regex]::Escape("  let booking: any = ins.data;"),
@'
  let booking: any = ins.data;

  // FREE RIDE PROMO RULES (RIDES ONLY)
  // - If unverified and tries to book a ride: forfeit promo immediately (even if later verified)
  // - If verified and promo not yet used/forfeited: mark used on this booking to prevent abuse
  try {
    const svc = String((payload as any)?.service_type ?? (payload as any)?.serviceType ?? (payload as any)?.service ?? "").toLowerCase();
    const takeout = svc.includes("takeout") || !!(payload as any)?.vendor_id;
    const bid = booking?.id ? String(booking.id) : "";
    if (createdByUserId && bid && !takeout) {
      if (!isVerified) {
        await frForfeitIfNeeded(supabase as any, createdByUserId, "booked_unverified");
      } else {
        await frMarkUsedIfEligible(supabase as any, createdByUserId, bid);
      }
    }
  } catch {}
'@

# Also do the same for INS2 fallback path just before returning JSON:
# Find: `return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }, { status: 200 });`
if($txt -notmatch "FREE_RIDE_PROMO_INS2_MARK"){
  $txt = $txt -replace [regex]::Escape("    }return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }, { status: 200 });"),
@'
    }

    // FREE_RIDE_PROMO_INS2_MARK
    try {
      const takeout = isTakeout;
      const bid = booking?.id ? String(booking.id) : "";
      if (createdByUserId && bid && !takeout) {
        if (!isVerified) {
          await frForfeitIfNeeded(supabase as any, createdByUserId, "booked_unverified");
        } else {
          await frMarkUsedIfEligible(supabase as any, createdByUserId, bid);
        }
      }
    } catch {}

    return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }, { status: 200 });
'@
}

Write-Utf8NoBom $bookRoute $txt
Write-Host "[OK] Patched: app/api/public/passenger/book/route.ts"

# ------------------------------------------------------------
# D) Patch app/api/dispatch/status/route.ts (auto-credit +20 on promo ride completion)
# ------------------------------------------------------------
$txt = Read-Utf8NoBom $statusRoute

if($txt -notmatch "FREE_RIDE_DRIVER_CREDIT_BEGIN"){
  $helper = @'

/* FREE_RIDE_DRIVER_CREDIT_BEGIN */
async function freeRideCreditDriverOnComplete(supabase:any, booking:any): Promise<{ warning?: string }> {
  try {
    const bookingId = booking?.id ? String(booking.id) : "";
    const driverId = booking?.driver_id ? String(booking.driver_id) : "";
    if (!bookingId || !driverId) return {};

    // Only if this booking is the promo trip
    const ar = await supabase
      .from("passenger_free_ride_audit")
      .select("*")
      .eq("trip_id", bookingId)
      .maybeSingle();

    if (ar?.error || !ar?.data) return {};
    if (String(ar.data.status || "") !== "used") return {};

    // Prevent double-credit: check reason unique by booking
    const reason = "free_ride_credit:" + bookingId;
    const ex = await supabase
      .from("driver_wallet_transactions")
      .select("id")
      .eq("reason", reason)
      .limit(1);

    if (!ex?.error && Array.isArray(ex.data) && ex.data.length) {
      return {};
    }

    // Compute next balance_after from last known entry
    let prevBal = 0;
    try {
      const last = await supabase
        .from("driver_wallet_transactions")
        .select("balance_after")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!last?.error && Array.isArray(last.data) && last.data.length) {
        const v = Number(last.data[0]?.balance_after);
        if (Number.isFinite(v)) prevBal = v;
      }
    } catch {}

    const credit = Number(ar.data.driver_credit_php ?? 20);
    const nextBal = prevBal + (Number.isFinite(credit) ? credit : 20);

    // Insert credit row
    const ins = await supabase.from("driver_wallet_transactions").insert({
      driver_id: driverId,
      amount: credit,
      balance_after: nextBal,
      reason: reason,
      booking_id: bookingId,
      created_at: new Date().toISOString(),
    });

    if (ins?.error) {
      return { warning: "FREE_RIDE_CREDIT_INSERT_ERROR: " + String(ins.error.message || "insert failed") };
    }

    // Backfill audit with driver_id if missing (best-effort)
    try {
      if (!ar.data.driver_id) {
        await supabase
          .from("passenger_free_ride_audit")
          .update({ driver_id: driverId, used_at: ar.data.used_at || new Date().toISOString() })
          .eq("passenger_id", String(ar.data.passenger_id));
      }
    } catch {}

    return {};
  } catch (e:any) {
    return { warning: "FREE_RIDE_CREDIT_EXCEPTION: " + String(e?.message || e) };
  }
}
/* FREE_RIDE_DRIVER_CREDIT_END */

'@

  $txt = $txt -replace [regex]::Escape("export async function GET(req: Request) {"), ($helper + "export async function GET(req: Request) {")
}

# After wallet sync on complete, call the free ride credit helper
# Find: `if (target === "completed") {`
if($txt -notmatch "FREE_RIDE_CREDIT_CALL"){
  $txt = $txt -replace [regex]::Escape('  if (target === "completed") {
    const w = await bestEffortWalletSyncOnComplete(supabase, updatedBooking);
    walletWarn = w.warning ?? null;
  }'),
@'
  if (target === "completed") {
    const w = await bestEffortWalletSyncOnComplete(supabase, updatedBooking);
    walletWarn = w.warning ?? null;

    // FREE_RIDE_CREDIT_CALL (promo ride only)
    const fr = await freeRideCreditDriverOnComplete(supabase as any, updatedBooking);
    if (fr.warning) walletWarn = walletWarn ? (String(walletWarn) + "; " + String(fr.warning)) : String(fr.warning);
  }
'@
}

Write-Utf8NoBom $statusRoute $txt
Write-Host "[OK] Patched: app/api/dispatch/status/route.ts"

Write-Host ""
Write-Host "[DONE] JRIDE Free Ride + Verify flow patch applied."
Write-Host "Next: npm run build, then deploy."
