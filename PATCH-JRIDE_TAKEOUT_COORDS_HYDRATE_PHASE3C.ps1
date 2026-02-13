$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\api\vendor-orders\route.ts"
if (!(Test-Path $path)) { Fail "Missing: $path (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Idempotency: if already patched, stop
if ($txt -match "PHASE3C_TAKEOUT_COORDS_HYDRATE_START") {
  Ok "[OK] Phase 3C already present. No changes made."
  exit 0
}

$anchor = "// CREATE PATH (Phase 2D snapshot lock runs ONLY here)"
if ($txt -notmatch [regex]::Escape($anchor)) {
  Fail "Could not find CREATE PATH anchor comment in vendor-orders route.ts. File format differs."
}

$insert = @'
// PHASE3C_TAKEOUT_COORDS_HYDRATE_START
// Goal: ensure takeout-created bookings have pickup/dropoff coords so LiveTrips can assign.
// No auth changes, no schema changes, schema-safe update only.

function pickNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLatLng(obj: any): { lat: number | null; lng: number | null } {
  if (!obj) return { lat: null, lng: null };
  const lat =
    pickNum(obj.pickup_lat) ?? pickNum(obj.lat) ?? pickNum(obj.latitude) ?? pickNum(obj.location_lat) ?? pickNum(obj.pickupLatitude) ?? null;
  const lng =
    pickNum(obj.pickup_lng) ?? pickNum(obj.lng) ?? pickNum(obj.longitude) ?? pickNum(obj.location_lng) ?? pickNum(obj.pickupLongitude) ?? null;
  return { lat, lng };
}

function pickTown(obj: any): string | null {
  if (!obj) return null;
  const v = String(obj.town ?? obj.municipality ?? obj.city ?? obj.area ?? obj.zone_town ?? "").trim();
  return v ? v : null;
}

function pickVendorLabel(obj: any): string | null {
  if (!obj) return null;
  const v =
    String(obj.pickup_label ?? obj.location_label ?? obj.address_label ?? obj.address_text ?? obj.address ?? obj.store_name ?? obj.name ?? "").trim();
  return v ? v : null;
}

async function tryLoadOne(table: string, id: string): Promise<any | null> {
  try {
    const r = await admin!.from(table).select("*").eq("id", id).maybeSingle();
    if (r && !r.error && r.data) return r.data;
  } catch {}
  return null;
}

async function loadVendorMeta(vendor_id: string): Promise<any | null> {
  // try multiple common vendor tables, first that returns data wins
  const tables = ["vendors", "vendor_profiles", "vendor_settings", "vendor_accounts"];
  for (const t of tables) {
    const d = await tryLoadOne(t, vendor_id);
    if (d) return d;
  }
  return null;
}

async function loadPrimaryAddressByDeviceKey(deviceKey: string): Promise<any | null> {
  const dk = String(deviceKey || "").trim();
  if (!dk) return null;
  try {
    // table name used by your /api/passenger-addresses route is usually passenger_addresses
    const r = await admin!
      .from("passenger_addresses")
      .select("*")
      .eq("device_key", dk)
      .order("is_primary", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1);

    if (r && !r.error && Array.isArray(r.data) && r.data[0]) return r.data[0];
  } catch {}
  return null;
}

async function schemaSafeUpdateBooking(id: string, initial: Record<string, any>) {
  let payload: Record<string, any> = { ...initial };

  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await admin!.from("bookings").update(payload).eq("id", id).select("id").single();

    if (!res.error) return res;

    const msg = String((res.error as any)?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i);
    if (m && m[1]) {
      const col = String(m[1]);
      delete (payload as any)[col];
      continue;
    }
    return res;
  }

  return { data: null, error: { message: "DB_ERROR: schema-safe update retries exceeded" } } as any;
}
// PHASE3C_TAKEOUT_COORDS_HYDRATE_END

'@

# Insert helper block right after CREATE PATH anchor comment
$txt = $txt.Replace($anchor, ($anchor + "`r`n" + $insert.TrimEnd() + "`r`n"))

# Now inject "hydrate coords" step after bookingId is known (create path only)
$needle = 'if (!bookingId) return json(500, { ok: false, error: "CREATE_FAILED", message: "Missing booking id after insert" });'
if ($txt -notmatch [regex]::Escape($needle)) {
  Fail "Could not find bookingId missing-check line to inject after. File format differs."
}

$hydrate = @'
  // PHASE3C_TAKEOUT_COORDS_HYDRATE_STEP_START
  try {
    // 1) vendor pickup coords (preferred)
    const vendorMeta = await loadVendorMeta(vendor_id);
    const vLL = pickLatLng(vendorMeta);
    const vTown = pickTown(vendorMeta);
    const vLabel = pickVendorLabel(vendorMeta);

    // 2) dropoff coords from passenger primary address if available (device_key comes from takeout page)
    const addr = await loadPrimaryAddressByDeviceKey(String(body?.device_key ?? body?.deviceKey ?? ""));
    const aLat =
      pickNum(addr?.dropoff_lat) ?? pickNum(addr?.lat) ?? pickNum(addr?.latitude) ?? pickNum(addr?.location_lat) ?? null;
    const aLng =
      pickNum(addr?.dropoff_lng) ?? pickNum(addr?.lng) ?? pickNum(addr?.longitude) ?? pickNum(addr?.location_lng) ?? null;

    // 3) accept coords if caller provided them (future-proof)
    const bPickupLat = pickNum(body?.pickup_lat ?? body?.pickupLat ?? null);
    const bPickupLng = pickNum(body?.pickup_lng ?? body?.pickupLng ?? null);
    const bDropLat = pickNum(body?.dropoff_lat ?? body?.dropoffLat ?? body?.to_lat ?? body?.toLat ?? null);
    const bDropLng = pickNum(body?.dropoff_lng ?? body?.dropoffLng ?? body?.to_lng ?? body?.toLng ?? null);

    const pickup_lat = bPickupLat ?? vLL.lat;
    const pickup_lng = bPickupLng ?? vLL.lng;

    // If we can't find a dropoff coordinate, fallback to pickup coords (pilot-safe: removes PROBLEM trips)
    const dropoff_lat = bDropLat ?? aLat ?? pickup_lat ?? null;
    const dropoff_lng = bDropLng ?? aLng ?? pickup_lng ?? null;

    const updatePayload: Record<string, any> = {
      // labels (schema-safe; unknown cols auto-dropped)
      pickup_label: vLabel || null,
      from_label: vLabel || null,

      dropoff_label: to_label || null,
      to_label: to_label || null,

      // coords
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,

      // town defaults help zoning
      town: vTown || null,
    };

    // only update if we have at least pickup coords (and ideally dropoff coords too)
    const hasAny =
      (pickup_lat != null && pickup_lng != null) || (dropoff_lat != null && dropoff_lng != null);

    if (hasAny) {
      await schemaSafeUpdateBooking(bookingId, updatePayload);
    }
  } catch {
    // fail-open: creation must succeed even if hydration fails
  }
  // PHASE3C_TAKEOUT_COORDS_HYDRATE_STEP_END
'@

$replacement = $needle + "`r`n`r`n" + $hydrate.TrimEnd() + "`r`n"
$txt = $txt.Replace($needle, $replacement)

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8)

Ok "[OK] Patched vendor-orders create path to hydrate coords (Phase 3C)."
Ok "[NEXT] Run build. Then test Takeout -> Admin LiveTrips assignment."
