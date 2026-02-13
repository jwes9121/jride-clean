# PATCH-JRIDE_PHASE8E_B_ARRIVED_INJECTOR.ps1
# Fix: LiveTrips page-data RPC may omit 'arrived'. We inject arrived bookings from DB into the trips list.
# Safe: only selects columns we KNOW exist (id, booking_code, status, town, driver_id, vendor_id, trip_type).
# Backups created.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$target = "app\api\admin\livetrips\page-data\route.ts"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw

# Anchor: right after tripsRaw extraction
$anchor = "const tripsRaw = extractTripsAnyShape(rpcData);"
if($txt -notmatch [regex]::Escape($anchor)){ Fail "Could not find anchor: $anchor" }

# Avoid double-patching
if($txt -match "ARRIVED_INJECTOR_START"){
  Ok "Arrived injector already present. No changes."
  exit 0
}

$inject = @'

    // --- ARRIVED_INJECTOR_START ---
    // If the RPC does not include 'arrived' trips, inject them directly from bookings so LiveTrips can show Arrived immediately.
    // We only select known-safe columns to avoid schema assumptions.
    const rpcIds = new Set(
      tripsRaw
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const rpcCodes = new Set(
      tripsRaw
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    // Pull arrived bookings (these often get omitted by RPC filters upstream)
    const { data: arrivedRows, error: arrivedErr } = await supabase
      .from("bookings")
      .select("id, booking_code, status, town, driver_id, vendor_id, trip_type")
      .eq("status", "arrived")
      .order("created_at", { ascending: false })
      .limit(50);

    if (arrivedErr) {
      console.error("LIVETRIPS_ARRIVED_INJECT_ERROR", arrivedErr);
    } else if (arrivedRows?.length) {
      const arrivedTrips = (arrivedRows as any[])
        .filter((b) => {
          const id = b?.id ? String(b.id) : "";
          const code = b?.booking_code ? String(b.booking_code) : "";
          if (id && rpcIds.has(id)) return false;
          if (code && rpcCodes.has(code)) return false;
          return true;
        })
        .map((b) => ({
          id: b.id,
          uuid: b.id,
          booking_code: b.booking_code,
          status: b.status,
          driver_id: b.driver_id ?? null,
          vendor_id: b.vendor_id ?? null,
          trip_type: b.trip_type ?? null,
          zone: b.town ?? null,
          town: b.town ?? null,
          __injected: true
        }));

      if (arrivedTrips.length) {
        // Merge: keep RPC trips first (rich data), then injected arrived (minimal but visible in UI)
        tripsRaw.push(...arrivedTrips);
        console.log("LIVETRIPS_ARRIVED_INJECTED_COUNT", arrivedTrips.length);
      }
    }
    // --- ARRIVED_INJECTOR_END ---

'@

# Insert right after anchor line
$idx = $txt.IndexOf($anchor)
if($idx -lt 0){ Fail "Anchor index not found." }
$insertPos = $idx + $anchor.Length

$txt2 = $txt.Insert($insertPos, $inject)

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Ok "Patched: $target (ARRIVED injector added)"
Ok "Done."
