# PATCH-JRIDE_PHASE8B_FIX_ARRIVED_EMPTY_TAB_BY_FALLBACK.ps1
# Adds a fallback fetch in app/api/admin/livetrips/page-data/route.ts so "arrived" trips show in table,
# even if the RPC does not return them.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m) { throw "[FAIL] $m" }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$target = "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding UTF8

# Anchor: right after tripsRaw extraction
$anchor = "const tripsRaw = extractTripsAnyShape(rpcData);"
if ($txt.IndexOf($anchor) -lt 0) { Fail "Anchor not found: $anchor" }

if ($txt.IndexOf("FALLBACK_ACTIVE_BOOKINGS_MERGE_BEGIN") -ge 0) {
  Ok "[OK] Fallback merge already present. No change."
  exit 0
}

$insert = @"
$anchor

    // FALLBACK_ACTIVE_BOOKINGS_MERGE_BEGIN
    // If RPC doesn't include some active statuses (ex: 'arrived'), we still want them in the table.
    // We pull directly from bookings and merge any missing by id/booking_code.
    const existingCodes = new Set(
      (tripsRaw as any[])
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );
    const existingIds = new Set(
      (tripsRaw as any[])
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const ACTIVE_STATUSES = ["assigned", "on_the_way", "arrived", "enroute", "on_trip"];

    try {
      const { data: activeRows, error: activeErr } = await supabase
        .from("bookings")
        .select("*")
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(200);

      if (activeErr) {
        console.error("LIVETRIPS_FALLBACK_ACTIVE_ERROR", activeErr);
      } else if (Array.isArray(activeRows) && activeRows.length) {
        for (const b of activeRows) {
          const bid = b?.id != null ? String(b.id) : "";
          const bcode = b?.booking_code != null ? String(b.booking_code) : "";

          // Merge only if missing from RPC list
          if ((bid && existingIds.has(bid)) || (bcode && existingCodes.has(bcode))) continue;

          // Shape into a "trip-like" object for the frontend
          const tripLike: any = {
            id: bid || null,
            uuid: bid || null,
            booking_id: bid || null,
            booking_code: bcode || null,
            status: b?.status ?? null,
            town: b?.town ?? null,
            zone: b?.town ?? null,
            driver_id: b?.driver_id ?? null,

            pickup_lat: b?.pickup_lat ?? null,
            pickup_lng: b?.pickup_lng ?? null,
            dropoff_lat: b?.dropoff_lat ?? null,
            dropoff_lng: b?.dropoff_lng ?? null,

            // labels (support both naming styles)
            pickup_label: b?.pickup_label ?? b?.from_label ?? null,
            dropoff_label: b?.dropoff_label ?? b?.to_label ?? null,

            created_at: b?.created_at ?? null,
            updated_at: b?.updated_at ?? null,
            trip_type: b?.trip_type ?? null,
            vendor_id: b?.vendor_id ?? null
          };

          (tripsRaw as any[]).push(tripLike);

          if (bid) existingIds.add(bid);
          if (bcode) existingCodes.add(bcode);
        }
      }
    } catch (e: any) {
      console.error("LIVETRIPS_FALLBACK_ACTIVE_EXCEPTION", e?.message || e);
    }
    // FALLBACK_ACTIVE_BOOKINGS_MERGE_END
"@

# Replace only the first occurrence of anchor with anchor+insert block (we already included anchor in insert)
$idx = $txt.IndexOf($anchor)
if ($idx -lt 0) { Fail "Internal: anchor index not found" }

# Build new content: remove original anchor line occurrence by replacing that exact substring at first match
$txt2 = $txt.Substring(0, $idx) + $insert + $txt.Substring($idx + $anchor.Length)

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Ok "[OK] Patched: $target"
Ok "[OK] Added fallback merge so ARRIVED rows show in Trips table."
