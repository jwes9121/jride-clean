# PATCH-JRIDE_PHASE2D_WIRE_SNAPSHOT_PASSENGER_BOOK.ps1
# Phase 2D: Wire snapshot lock into REAL submit writer:
# app/api/public/passenger/book/route.ts
# - Detect takeout requests
# - Create booking_code TAKEOUT-UI-...
# - Insert snapshot rows into public.takeout_order_items
# - Update public.bookings.takeout_items_subtotal
# - IMPORTANT: Skip dispatch assign for takeout (no driver/dispatcher changes)
# Backup + UTF-8 no BOM

$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  try { $sw.Write($content) } finally { $sw.Dispose() }
}

function BackupFile([string]$path) {
  if (!(Test-Path $path)) { Fail "Missing file: $path" }
  $bak = "$path.bak.$(Stamp)"
  Copy-Item -Force $path $bak
  Ok "Backup: $bak"
}

function ReplaceOrFail([string]$text, [string]$pattern, [string]$replacement, [string]$why) {
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $rx.IsMatch($text)) { Fail "Anchor not found for: $why" }
  return $rx.Replace($text, $replacement, 1)
}

$root = (Get-Location).Path
$path = Join-Path $root "app\api\public\passenger\book\route.ts"
Info "Repo root: $root"
if (!(Test-Path $path)) { Fail "Missing: app\api\public\passenger\book\route.ts" }

BackupFile $path

$txt = Get-Content -Raw $path

# ----------------------------
# 1) Insert Phase2D helper block (only once)
# ----------------------------
if ($txt -notmatch "PHASE2D_ORDER_SNAPSHOT_LOCK_BEGIN") {

  $helper = @'
/* PHASE2D_ORDER_SNAPSHOT_LOCK_BEGIN */
function isTakeoutReq(body: any): boolean {
  const s = String(body?.service || body?.service_type || body?.serviceType || body?.trip_type || body?.tripType || "").toLowerCase();
  if (s.includes("takeout") || s.includes("food") || s.includes("order")) return true;
  if (body?.vendor_id || body?.vendorId) return true;
  if (Array.isArray(body?.items) && body.items.length) return true;
  if (Array.isArray(body?.cart) && body.cart.length) return true;
  if (Array.isArray(body?.order_items) && body.order_items.length) return true;
  if (Array.isArray(body?.takeout_items) && body.takeout_items.length) return true;
  return false;
}

function pickItemsArray(body: any): any[] {
  const cands = [body?.items, body?.cart, body?.order_items, body?.takeout_items, body?.menu_items];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
}

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pickId(it: any): string {
  return String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim();
}

function pickQty(it: any): number {
  const q = parseInt(String(it?.quantity ?? it?.qty ?? it?.count ?? 1), 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function pickName(it: any): string {
  return String(it?.name || it?.title || it?.label || "").trim();
}

function pickPrice(it: any): number {
  return num(it?.price ?? it?.unit_price ?? it?.unitPrice ?? it?.amount ?? 0);
}

async function fetchMenuRowsForVendor(supabase: any, vendorId: string): Promise<any[]> {
  // Try likely menu tables in order; select * to survive column differences.
  const tables = ["vendor_menu_items", "takeout_menu_items", "menu_items", "vendor_menu"];
  for (const t of tables) {
    try {
      const q = supabase.from(t).select("*").limit(1000);
      // try filter if vendor column exists (best effort)
      let r = await q.eq("vendor_id", vendorId);
      if (r?.error) {
        r = await supabase.from(t).select("*").limit(1000); // fallback no filter
      }
      if (!r?.error && Array.isArray(r.data)) return r.data;
    } catch {}
  }
  return [];
}

function mapMenuById(menuRows: any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const r of (menuRows || [])) {
    const id =
      String(r?.menu_item_id || r?.id || r?.item_id || r?.menuItemId || "").trim();
    if (id) m[id] = r;
  }
  return m;
}

async function snapshotTakeoutOrNull(supabase: any, bookingId: string, body: any): Promise<{ ok: boolean; subtotal: number; inserted: number; note?: string }> {
  const vendorId = String(body?.vendor_id || body?.vendorId || "").trim();
  const itemsIn = pickItemsArray(body);
  if (!vendorId || !itemsIn.length) return { ok: false, subtotal: 0, inserted: 0, note: "Missing vendor_id or items[]" };

  const menuRows = await fetchMenuRowsForVendor(supabase, vendorId);
  const byId = mapMenuById(menuRows);

  const rows: any[] = [];
  let subtotal = 0;

  for (const it of itemsIn) {
    const mid = pickId(it);
    const qty = pickQty(it);

    const mr = mid ? byId[mid] : null;
    const name = String((mr?.name ?? mr?.item_name ?? mr?.title) ?? pickName(it) ?? "").trim();
    const price = num((mr?.price ?? mr?.unit_price ?? mr?.amount) ?? pickPrice(it) ?? 0);

    if (!name || !Number.isFinite(price)) continue;

    rows.push({
      booking_id: bookingId,
      menu_item_id: mid || null,
      name,
      price,
      quantity: qty,
      snapshot_at: new Date().toISOString(),
    });

    subtotal += price * qty;
  }

  if (!rows.length) return { ok: false, subtotal: 0, inserted: 0, note: "No valid items to snapshot" };

  const ins = await supabase.from("takeout_order_items").insert(rows);
  if (ins?.error) return { ok: false, subtotal: 0, inserted: 0, note: "Insert snapshot failed: " + ins.error.message };

  const up = await supabase.from("bookings").update({ takeout_items_subtotal: subtotal }).eq("id", bookingId);
  if (up?.error) return { ok: true, subtotal, inserted: rows.length, note: "Subtotal update failed: " + up.error.message };

  return { ok: true, subtotal, inserted: rows.length };
}
/* PHASE2D_ORDER_SNAPSHOT_LOCK_END */
'@

  # Insert helper block after BookReq type (stable anchor)
  $txt = ReplaceOrFail $txt '(type\s+BookReq\s*=\s*\{[\s\S]*?\};\s*)' ('$1' + "`r`n`r`n" + $helper + "`r`n") "Insert Phase2D helper block"
  Ok "Inserted Phase2D helper block."
} else {
  Info "Phase2D helper block already present. Skipping."
}

# ----------------------------
# 2) Add isTakeout detection after body parse
# ----------------------------
if ($txt -notmatch 'const\s+isTakeout\s*=') {
  $txt = ReplaceOrFail $txt '(const\s+body\s*=\s*\(await\s+req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)\)\s+as\s+BookReq;\s*)' ('$1' + "`r`n`r`n  const isTakeout = isTakeoutReq(body as any);`r`n") "Insert isTakeout flag"
  Ok "Inserted isTakeout flag."
} else {
  Info "isTakeout flag already present. Skipping."
}

# ----------------------------
# 3) Make takeout booking_code prefix TAKEOUT-UI-
# ----------------------------
# Replace: const booking_code = `JR-UI-${codeNow()}-${rand4()}`;
$txt = ReplaceOrFail $txt '(const\s+booking_code\s*=\s*`JR-UI-\$\{codeNow\(\)\}-\$\{rand4\(\)\}`;\s*)' @'
const booking_code = isTakeout
    ? `TAKEOUT-UI-${codeNow()}-${rand4()}`
    : `JR-UI-${codeNow()}-${rand4()}`;
'@ "Make booking_code conditional (TAKEOUT-UI vs JR-UI)"
Ok "Patched booking_code."

# ----------------------------
# 4) Add takeout fields to payload (vendor_id/service_type/vendor_status)
# ----------------------------
if ($txt -notmatch "PHASE2D_PAYLOAD_TAKEOUT_FIELDS") {
  $payloadInject = @'
  /* PHASE2D_PAYLOAD_TAKEOUT_FIELDS */
  if (isTakeout) {
    const vendorId = String((body as any)?.vendor_id || (body as any)?.vendorId || "").trim();
    (payload as any).service_type = "takeout";
    (payload as any).vendor_id = vendorId || null;
    (payload as any).vendor_status = "preparing";
    (payload as any).takeout_items_subtotal = 0;
    // Optional pass-through fields if provided by UI (safe)
    (payload as any).customer_phone = (body as any)?.customer_phone ?? (body as any)?.customerPhone ?? null;
    (payload as any).delivery_address = (body as any)?.delivery_address ?? (body as any)?.deliveryAddress ?? null;
    (payload as any).note = (body as any)?.note ?? null;
  }
'@

  $txt = ReplaceOrFail $txt '(const\s+payload:\s+any\s*=\s*\{\s*[\s\S]*?status:\s*"requested",\s*\};)' ('$1' + "`r`n`r`n" + $payloadInject) "Inject takeout payload fields"
  Ok "Injected takeout payload fields."
} else {
  Info "Takeout payload fields already present. Skipping."
}

# ----------------------------
# 5) After booking insert succeeds (both branches), snapshot for takeout
#    and SKIP dispatch assign for takeout.
# ----------------------------

# A) Patch the "ins2" branch return path: after reread and before return
if ($txt -notmatch "PHASE2D_TAKEOUT_SNAPSHOT_INS2") {
  $txt = ReplaceOrFail $txt '(//\s*re-read\s+booking\s+for\s+final\s+status/driver_id\s*[\s\S]*?if\s*\(!reread\.error\s*&&\s*reread\.data\)\s*booking\s*=\s*reread\.data;\s*)' @'
$1

    /* PHASE2D_TAKEOUT_SNAPSHOT_INS2 */
    let takeoutSnapshot: any = null;
    if (isTakeout) {
      try {
        takeoutSnapshot = await snapshotTakeoutOrNull(supabase as any, String(booking.id), body as any);
      } catch (e: any) {
        takeoutSnapshot = { ok: false, note: "Snapshot threw: " + String(e?.message || e) };
      }
    }
'@ "Insert snapshot in ins2 branch"
  Ok "Inserted takeout snapshot in ins2 branch."
}

# B) Patch the "ins" success branch: right after booking assigned to ins.data
if ($txt -notmatch "PHASE2D_TAKEOUT_SNAPSHOT_INS1") {
  $txt = ReplaceOrFail $txt '(let\s+booking:\s+any\s*=\s*ins\.data;\s*)' @'
$1

  /* PHASE2D_TAKEOUT_SNAPSHOT_INS1 */
  let takeoutSnapshot: any = null;
  if (isTakeout) {
    try {
      takeoutSnapshot = await snapshotTakeoutOrNull(supabase as any, String(booking.id), body as any);
    } catch (e: any) {
      takeoutSnapshot = { ok: false, note: "Snapshot threw: " + String(e?.message || e) };
    }
  }
'@ "Insert snapshot in ins1 branch"
  Ok "Inserted takeout snapshot in ins1 branch."
}

# C) Skip dispatch assign for takeout in BOTH branches by guarding fetch call blocks.
# Guard the first assign call block (ins2 branch) anchor "Phase 6H2: CALL DISPATCH ASSIGN"
# We'll wrap the assign fetch in if (!isTakeout) { ... } else { assign = { ok:true, skipped:true } }
if ($txt -notmatch "PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT") {
  $txt = ReplaceOrFail $txt '(//\s*Phase\s+6H2:\s*CALL\s+DISPATCH\s+ASSIGN[\s\S]*?let\s+assign:\s+any\s*=\s*\{\s*ok:\s*false,\s*note:\s*"Assignment\s+skipped\."\s*\};\s*try\s*\{\s*const\s+resp\s*=\s*await\s+fetch\([\s\S]*?\}\s*catch\s*\(err:\s*any\)\s*\{\s*assign\s*=\s*\{\s*ok:\s*false,[\s\S]*?\};\s*\}\s*)' @'
/* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT */
    // Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
    const baseUrl = await getBaseUrlFromHeaders(req);
    let assign: any = { ok: false, note: "Assignment skipped." };

    if (!isTakeout) {
      try {
        const resp = await fetch(`${baseUrl}/api/dispatch/assign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ booking_id: String(booking.id) }),
        });
        const j = await resp.json().catch(() => ({}));
        assign = j;
      } catch (err: any) {
        assign = { ok: false, note: "Assign call failed: " + String(err?.message || err) };
      }
    } else {
      assign = { ok: true, skipped: true, reason: "takeout_booking" };
    }
/* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT_END */
'@ "Guard assign call (ins2 branch)"
  Ok "Guarded dispatch assign call for takeout (ins2 branch)."
} else {
  Info "Assign guard already present. Skipping."
}

# D) Ensure the final JSON response includes takeoutSnapshot (both branches use same return shape)
# ins2 return:
$txt = $txt -replace '\{\s*ok:\s*true,\s*env:\s*jrideEnvEcho\(\),\s*booking_code,\s*booking,\s*assign\s*\}', '{ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }'

WriteUtf8NoBom $path $txt
Ok "Patched: app/api/public/passenger/book/route.ts (Phase 2D wired)"
Info "NEXT: run npm run build, then create a NEW takeout order with vendor_id + items[] so snapshots are written."
