# PATCH-JRIDE_PHASE15B_VENDOR_ORDERS_POST_CREATE_OR_UPDATE.ps1
# One file only: app/api/vendor-orders/route.ts
# Adds/patches POST to support:
# - Create when order_id missing (insert into bookings)
# - Update when order_id present (update vendor_status)
# No DB assumptions beyond columns already referenced by this module: bookings.vendor_id, bookings.vendor_status, bookings.passenger_name, bookings.service_type, bookings.status

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\api\vendor-orders\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Ensure imports exist
if ($txt -notmatch 'NextRequest') {
  # only if they use Request currently; we keep Request but use req.json so OK.
  # no action
}

# If POST doesn't exist, append a safe POST handler.
if ($txt -notmatch 'export\s+async\s+function\s+POST\s*\(') {
  $post = @'

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  try {
    const body = await req.json().catch(() => ({} as any));

    // Accept both snake_case and camelCase from UI
    const order_id = String(body.order_id ?? body.orderId ?? "").trim();
    const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();

    const vendor_status_in = String(body.vendor_status ?? body.vendorStatus ?? "").trim();
    const vendor_status = vendor_status_in || "preparing";

    // customer fields (UI sends these; we map to passenger_name which the GET already uses)
    const customer_name = String(body.customer_name ?? body.customerName ?? "").trim();
    const customer_phone = String(body.customer_phone ?? body.customerPhone ?? "").trim();
    const delivery_address = String(body.delivery_address ?? body.deliveryAddress ?? "").trim();
    const items = String(body.items ?? "").trim();
    const note = String(body.note ?? "").trim();

    if (!vendor_id) {
      return NextResponse.json(
        { ok: false, error: "vendor_id required", message: "vendor_id required" },
        { status: 400 }
      );
    }

    // CREATE (no order_id): insert a vendor-backed booking row
    if (!order_id) {
      // Minimal insert: only use columns already implied by your vendor-orders GET mapping
      // and common booking fields. Avoid assuming extra columns exist.
      const insertRow: any = {
        vendor_id,
        vendor_status,
        service_type: "takeout",
        status: "requested",
      };

      // Safe optional columns (only set if present in payload)
      if (customer_name) insertRow.passenger_name = customer_name;
      // These may or may not exist; still safe to include if your table has them.
      if (customer_phone) insertRow.passenger_phone = customer_phone;
      if (delivery_address) insertRow.dropoff_label = delivery_address;
      if (items) insertRow.items = items;
      if (note) insertRow.note = note;

      const { data, error } = await supabase
        .from("bookings")
        .insert(insertRow)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, message: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: "created",
        order_id: data?.id ?? null,
        id: data?.id ?? null,
        booking_code: data?.booking_code ?? null,
        vendor_id: data?.vendor_id ?? vendor_id,
        vendor_status: data?.vendor_status ?? vendor_status,
      });
    }

    // UPDATE (order_id present): update vendor_status only (safe)
    if (!vendor_status) {
      return NextResponse.json(
        { ok: false, error: "vendor_status required", message: "vendor_status required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ vendor_status })
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      action: "updated",
      order_id: data?.id ?? order_id,
      id: data?.id ?? order_id,
      vendor_id: data?.vendor_id ?? vendor_id,
      vendor_status: data?.vendor_status ?? vendor_status,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error", message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

'@

  $txt = $txt.TrimEnd() + "`r`n`r`n" + $post
  Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
  Ok "Added POST handler to: $rel"
}
else {
  # POST exists — patch it by inserting a CREATE-when-no-order_id block
  # Insert right after we parse body (or right after const supabase line if no body parse anchor found)
  $insertAfter = 'const\s+supabase\s*=\s*createRouteHandlerClient\(\{\s*cookies\s*\}\);\s*'
  if ($txt -notmatch $insertAfter) { Fail "Could not find supabase client line inside POST." }

  # Only patch once
  if ($txt -match 'VENDOR_ORDERS_POST_CREATE_OR_UPDATE') {
    Info "POST already patched for create/update. No change."
    exit 0
  }

  $patchBlock = @'

    // VENDOR_ORDERS_POST_CREATE_OR_UPDATE
    // Accept both snake_case and camelCase from UI
    const body = await req.json().catch(() => ({} as any));

    const order_id = String(body.order_id ?? body.orderId ?? "").trim();
    const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();

    const vendor_status_in = String(body.vendor_status ?? body.vendorStatus ?? "").trim();
    const vendor_status = vendor_status_in || "preparing";

    const customer_name = String(body.customer_name ?? body.customerName ?? "").trim();
    const customer_phone = String(body.customer_phone ?? body.customerPhone ?? "").trim();
    const delivery_address = String(body.delivery_address ?? body.deliveryAddress ?? "").trim();
    const items = String(body.items ?? "").trim();
    const note = String(body.note ?? "").trim();

    if (!vendor_id) {
      return NextResponse.json(
        { ok: false, error: "vendor_id required", message: "vendor_id required" },
        { status: 400 }
      );
    }

    // CREATE (no order_id): insert a vendor-backed booking row
    if (!order_id) {
      const insertRow: any = {
        vendor_id,
        vendor_status,
        service_type: "takeout",
        status: "requested",
      };

      if (customer_name) insertRow.passenger_name = customer_name;
      if (customer_phone) insertRow.passenger_phone = customer_phone;
      if (delivery_address) insertRow.dropoff_label = delivery_address;
      if (items) insertRow.items = items;
      if (note) insertRow.note = note;

      const { data, error } = await supabase
        .from("bookings")
        .insert(insertRow)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, message: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: "created",
        order_id: data?.id ?? null,
        id: data?.id ?? null,
        booking_code: data?.booking_code ?? null,
        vendor_id: data?.vendor_id ?? vendor_id,
        vendor_status: data?.vendor_status ?? vendor_status,
      });
    }

    // If order_id exists, we fall through to the existing UPDATE logic below.

'@

  # Replace the first occurrence of the supabase client line inside POST by adding our body parse block after it.
  # We must ensure we insert only within POST, but this is safe because supabase line is in POST in your file.
  $txt = [regex]::Replace($txt, $insertAfter, '$0' + $patchBlock, 1)

  Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
  Ok "Patched existing POST for create/update: $rel"
}

Ok "Done."
