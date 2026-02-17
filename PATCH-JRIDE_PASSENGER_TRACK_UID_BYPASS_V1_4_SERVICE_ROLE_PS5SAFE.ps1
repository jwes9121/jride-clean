param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
Write-Host "== PATCH JRIDE Passenger Track UID bypass (V1.4 service-role / PS5-safe) =="

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = $ProjRoot.TrimEnd("\","/")
if (!(Test-Path $root)) { Fail "[FAIL] ProjRoot not found: $root" }

$path = "$root\app\api\passenger\track\route.ts"
if (!(Test-Path -LiteralPath $path)) {
  $alt = "$root\app\api\public\passenger\track\route.ts"
  if (Test-Path -LiteralPath $alt) { $path = $alt } else { Fail "[FAIL] Could not find passenger track route.ts" }
}

Ok "[OK] Target: $path"

$raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8

if ($raw -notmatch "JRIDE_TRACK_UID_BYPASS_BEGIN" -or $raw -notmatch "JRIDE_TRACK_UID_BYPASS_END") {
  Fail "[FAIL] Existing bypass markers not found. (You need V1.3 already applied.)"
}

# Replacement block (keeps the markers)
$replacement = @'
// JRIDE_TRACK_UID_BYPASS_BEGIN
  // TEMP TEST BYPASS (SERVICE ROLE):
  // Allows tracking ONLY when uid matches created_by_user_id, even if user session cookies are missing.
  // Requires SUPABASE_SERVICE_ROLE_KEY (server-only) in env.
  // Usage: /ride/track?booking_code=...&uid=PASSENGER_UUID   (or code=...)
  try {
    const url2 = new URL(req.url);
    const code2 = (url2.searchParams.get("booking_code") || url2.searchParams.get("code") || "").trim();
    const uid = (url2.searchParams.get("uid") || "").trim();
    const uidOk = /^[0-9a-fA-F-]{36}$/.test(uid);

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      (process.env as any).SUPABASE_SERVICE_KEY ||
      "";

    const sbUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "";

    if (code2 && uidOk && serviceKey && sbUrl) {
      const { createClient: createAdminClient } = await import("@supabase/supabase-js");
      const admin = createAdminClient(sbUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "X-Client-Info": "jride-track-bypass" } },
      });

      const { data: row2, error: err2 } = await admin
        .from("bookings")
        .select(
          [
            "id",
            "booking_code",
            "status",
            "town",
            "from_label",
            "to_label",
            "pickup_lat",
            "pickup_lng",
            "dropoff_lat",
            "dropoff_lng",
            "created_at",
            "updated_at",
            "assigned_driver_id",
            "driver_id",
            "proposed_fare",
            "passenger_fare_response",
            "driver_status",
            "customer_status",
            "created_by_user_id",
          ].join(",")
        )
        .eq("booking_code", code2)
        .limit(1)
        .maybeSingle();

      if (!err2 && row2 && String((row2 as any).created_by_user_id || "").toLowerCase() === uid.toLowerCase()) {
        const b: any = row2 as any;
        const driverId = (b.driver_id || b.assigned_driver_id) as string | null;

        let driverProfile: any = null;
        let driverLocation: any = null;

        if (driverId) {
          const { data: dp } = await admin
            .from("driver_profiles")
            .select("driver_id, full_name, callsign, municipality, vehicle_type, plate_number, phone")
            .eq("driver_id", driverId)
            .maybeSingle();
          driverProfile = dp || null;

          const { data: dl } = await admin
            .from("driver_locations_latest")
            .select("driver_id, latitude, longitude, updated_at")
            .eq("driver_id", driverId)
            .maybeSingle();
          driverLocation = dl || null;
        }

        return NextResponse.json({
          ok: true,
          booking: row2,
          driver: driverProfile,
          driver_location: driverLocation,
        });
      }
    }
  } catch (e) {
    // ignore bypass errors
  }
// JRIDE_TRACK_UID_BYPASS_END
'@

# Regex replace everything between markers (inclusive)
$pattern = '(?s)//\s*JRIDE_TRACK_UID_BYPASS_BEGIN.*?//\s*JRIDE_TRACK_UID_BYPASS_END'
$patched = [regex]::Replace($raw, $pattern, $replacement, 1)

# Backup
$bakDir = "$root\_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$bakDir\passenger-track.route.ts.bak.UID_BYPASS_V1_4.$stamp"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

Set-Content -LiteralPath $path -Value $patched -Encoding UTF8
Ok "[OK] Replaced bypass block with SERVICE ROLE version (V1.4)."

Ok "`nNEXT: Ensure env var is set on Vercel:"
Ok "  SUPABASE_SERVICE_ROLE_KEY = <your service role key>"
Ok "`nThen rebuild + deploy and test:"
Ok "  https://app.jride.net/api/passenger/track?booking_code=TST-AUTOASSIGN-202602162204453&uid=f62080c7-e110-428c-932b-5484a361d5a3"
Ok "  https://app.jride.net/ride/track?booking_code=TST-AUTOASSIGN-202602162204453&uid=f62080c7-e110-428c-932b-5484a361d5a3"
