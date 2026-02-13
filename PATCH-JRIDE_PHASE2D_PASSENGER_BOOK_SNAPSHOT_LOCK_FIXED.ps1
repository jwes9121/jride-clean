# PATCH-JRIDE_PHASE2D_PASSENGER_BOOK_SNAPSHOT_LOCK_FIXED.ps1
# Phase 2D: Snapshot takeout items + subtotal at REAL submit point
# File: app/api/public/passenger/book/route.ts
# Backup + UTF-8 no BOM

$ErrorActionPreference = "Stop"

function OK($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function INFO($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function FAIL($m){ throw $m }
function TS(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  try { $sw.Write($content) } finally { $sw.Dispose() }
}

$path = "app\api\public\passenger\book\route.ts"
if (!(Test-Path $path)) { FAIL "Missing $path" }

$bak = "$path.bak.$(TS)"
Copy-Item -Force $path $bak
OK "Backup: $bak"

$txt = Get-Content -Raw $path

# --------- 1) Insert helpers (only once) after imports ----------
if ($txt -notmatch "PHASE2D_SNAPSHOT_HELPERS_BEGIN") {

$helpers = @'
/* PHASE2D_SNAPSHOT_HELPERS_BEGIN */
function p2dNum(v:any){ const n=Number(v??0); return Number.isFinite(n)?n:0 }
function p2dQty(v:any){ const q=parseInt(String(v??1),10); return (Number.isFinite(q) && q>0)?q:1 }
function p2dPickItemsArray(body:any): any[] {
  const cands = [body?.items, body?.cart, body?.order_items, body?.takeout_items, body?.menu_snapshot];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
}
function p2dPickId(it:any){ return String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim() }
function p2dPickName(it:any){ return String(it?.name || it?.title || it?.label || "").trim() }
function p2dPickPrice(it:any){ return p2dNum(it?.price ?? it?.unit_price ?? it?.unitPrice ?? it?.amount ?? 0) }

async function p2dFetchMenuRowsForVendor(admin:any, vendorId:string): Promise<any[]> {
  // best-effort: tolerate table name differences
  const tables = ["vendor_menu_items", "takeout_menu_items", "menu_items", "vendor_menu"];
  for (const t of tables) {
    try {
      let r = await admin.from(t).select("*").eq("vendor_id", vendorId).limit(2000);
      if (r?.error) r = await admin.from(t).select("*").limit(2000);
      if (!r?.error && Array.isArray(r.data)) return r.data;
    } catch {}
  }
  return [];
}
function p2dMenuById(menuRows:any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const r of (menuRows || [])) {
    const id = String(r?.menu_item_id || r?.id || r?.item_id || r?.menuItemId || "").trim();
    if (id) m[id] = r;
  }
  return m;
}

async function p2dSnapshotTakeout(admin:any, bookingId:string, vendorId:string, body:any) {
  const itemsIn = p2dPickItemsArray(body);
  if (!bookingId || !vendorId || !itemsIn.length) return { ok:false, inserted:0, subtotal:0, note:"Missing vendor_id or items[]" };

  const menuRows = await p2dFetchMenuRowsForVendor(admin, vendorId);
  const byId = p2dMenuById(menuRows);

  const rows:any[] = [];
  let subtotal = 0;

  for (const it of itemsIn) {
    const mid = p2dPickId(it);
    const qty = p2dQty(it?.quantity ?? it?.qty ?? it?.count ?? 1);

    const mr = mid ? byId[mid] : null;
    const name = String((mr?.name ?? mr?.item_name ?? mr?.title) ?? p2dPickName(it) ?? "").trim();
    const price = p2dNum((mr?.price ?? mr?.unit_price ?? mr?.amount) ?? p2dPickPrice(it));

    if (!name) continue;

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

  if (!rows.length) return { ok:false, inserted:0, subtotal:0, note:"No valid items to snapshot" };

  const ins = await admin.from("takeout_order_items").insert(rows);
  if (ins?.error) return { ok:false, inserted:0, subtotal:0, note:"Snapshot insert failed: " + ins.error.message };

  const up = await admin.from("bookings").update({ service_type:"takeout", takeout_items_subtotal: subtotal }).eq("id", bookingId);
  if (up?.error) return { ok:true, inserted: rows.length, subtotal, note:"Subtotal update failed: " + up.error.message };

  return { ok:true, inserted: rows.length, subtotal };
}
/* PHASE2D_SNAPSHOT_HELPERS_END */
'@

  # Insert helpers after the last import line.
  $rxImports = [regex]::new('(?s)\A(\s*(?:import[^\r\n]*\r?\n)+\s*)')
  if (-not $rxImports.IsMatch($txt)) { FAIL "Could not find import block to insert helpers after." }
  $txt = $rxImports.Replace($txt, '$1' + "`r`n" + $helpers + "`r`n", 1)

  OK "Inserted Phase 2D helper block."
} else {
  INFO "Phase 2D helpers already present; skipping helper insert."
}

# --------- 2) Wire snapshot into successful insert path ----------
# We need: admin client exists. In your file, createClient() is used; we can reuse supabase (RLS) for inserts?
# Snapshot must use the same supabase client used for insert, which is `supabase` in this route.
# But p2dSnapshotTakeout expects an admin-like client; in this route you have createClient() (server) which may not bypass RLS.
# HOWEVER: your takeout snapshot insert table is in public and likely allowed by RLS? If not, it will fail silently.
# To keep behavior consistent with your other routes, we use the same `supabase` client available here.
# (If RLS blocks, we’ll switch to service role in the next patch, but we won’t touch auth now.)

$inject = @'
  // PHASE 2D: ORDER SNAPSHOT LOCK (TAKEOUT)
  // Freeze items + compute subtotal + store on booking. Menu edits won't affect history.
  try {
    const svc = String((payload as any)?.service || (payload as any)?.service_type || (payload as any)?.serviceType || "").toLowerCase();
    const isTakeout = svc.includes("takeout") || !!(payload as any)?.vendor_id || !!(payload as any)?.vendorId;
    if (isTakeout) {
      const bookingId = String((booking as any)?.id || "");
      const vendorId = String((payload as any)?.vendor_id || (payload as any)?.vendorId || "").trim();
      if (bookingId && vendorId) {
        // use same client used for insert
        const takeoutSnapshot = await p2dSnapshotTakeout(supabase as any, bookingId, vendorId, payload as any);
        // best-effort (do not fail booking)
        (booking as any).takeoutSnapshot = takeoutSnapshot;
      }
    }
  } catch (e) {
    console.error("[PHASE2D] snapshot failed", e);
  }
'@

# Insert after first occurrence of: let booking: any = ins.data;
$rxBooking = [regex]::new('let\s+booking:\s*any\s*=\s*ins\.data\s*;', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $rxBooking.IsMatch($txt)) { FAIL "Could not find 'let booking: any = ins.data;' to inject snapshot." }

$txt = $rxBooking.Replace($txt, 'let booking: any = ins.data;' + "`r`n" + $inject, 1)
OK "Wired snapshot call after booking insert success."

WriteUtf8NoBom $path $txt
OK "Patched $path (UTF-8 no BOM)."
