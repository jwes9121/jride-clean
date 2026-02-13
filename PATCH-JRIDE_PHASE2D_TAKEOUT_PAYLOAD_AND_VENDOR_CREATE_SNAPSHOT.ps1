# PATCH-JRIDE_PHASE2D_TAKEOUT_PAYLOAD_AND_VENDOR_CREATE_SNAPSHOT.ps1
# Phase 2D: Send structured items[] from /takeout and snapshot-lock on /api/vendor-orders create
# Targets:
#  - app/takeout/page.tsx
#  - app/api/vendor-orders/route.ts
# Backups + UTF-8 no BOM

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

# ---------- 1) PATCH TAKEOUT PAGE (send items[] array) ----------
$takeout = "app\takeout\page.tsx"
if (!(Test-Path $takeout)) { FAIL "Missing $takeout" }
$bak1 = "$takeout.bak.$(TS)"
Copy-Item -Force $takeout $bak1
OK "Backup: $bak1"

$t = Get-Content -Raw $takeout

# Replace ONLY the payload field `items: itemsText,` with:
# - items_text: itemsText,
# - items: itemsSnapshot,
# and insert itemsSnapshot builder just above payload creation.

$rxPayloadStart = [regex]::new('(?s)(\s*//\s*Snapshot payload.*?\r?\n\s*const\s+payload\s*=\s*\{\s*\r?\n)', 'Singleline')
if (-not $rxPayloadStart.IsMatch($t)) { FAIL "Could not find payload block start near: // Snapshot payload ... const payload = {" }

$injectBuilder = @'
      // PHASE 2D: build structured items[] for snapshot lock (menu edits must NOT affect history)
      const menuById: Record<string, any> = {};
      try {
        for (const m of (Array.isArray(menu) ? menu : [])) {
          const id = String((m as any)?.menu_item_id || (m as any)?.id || "").trim();
          if (id) menuById[id] = m;
        }
      } catch {}

      const itemsSnapshot = (Array.isArray(selectedLines) ? selectedLines : [])
        .map((l: any) => {
          const mid = String(l?.menu_item_id || l?.menuItemId || l?.id || l?.item_id || "").trim();
          const mm = mid ? menuById[mid] : null;

          const name = String(l?.name || mm?.name || "").trim();
          const price = Number(mm?.price ?? l?.price ?? l?.unit_price ?? 0);
          const qtyRaw = l?.quantity ?? l?.qty ?? l?.count ?? 1;
          const qty = Math.max(1, parseInt(String(qtyRaw), 10) || 1);

          if (!name) return null;

          return {
            menu_item_id: mid || null,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity: qty,
          };
        })
        .filter(Boolean);
'@

# Insert builder right before payload block start
$t = $rxPayloadStart.Replace($t, $injectBuilder + "`r`n" + '$1', 1)

# Now replace `items: itemsText,` inside payload with items_text + items array
$rxItemsLine = [regex]::new('(?m)^\s*items\s*:\s*itemsText\s*,\s*$')
if (-not $rxItemsLine.IsMatch($t)) { FAIL "Could not find payload line: items: itemsText," }

$t = $rxItemsLine.Replace($t, '        items_text: itemsText,' + "`r`n" + '        items: itemsSnapshot,', 1)

WriteUtf8NoBom $takeout $t
OK "Patched $takeout (payload now sends structured items[])."

# ---------- 2) PATCH VENDOR-ORDERS API (snapshot on create) ----------
$api = "app\api\vendor-orders\route.ts"
if (!(Test-Path $api)) { FAIL "Missing $api" }
$bak2 = "$api.bak.$(TS)"
Copy-Item -Force $api $bak2
OK "Backup: $bak2"

$a = Get-Content -Raw $api

# We patch the CREATE branch return:
# return json(200, { ok: true, action: "created", order_id: data?.id ?? null });
# Replace with: snapshot insert into takeout_order_items + subtotal update + return takeoutSnapshot info.

$needleReturn = 'return json(200, { ok: true, action: "created", order_id: data?.id ?? null });'
if ($a -notmatch [regex]::Escape($needleReturn)) {
  FAIL "Could not find create return line in $api. Paste the create branch if it differs."
}

$replacementReturn = @'
    // PHASE 2D: ORDER SNAPSHOT LOCK (TAKEOUT) — freeze menu items per order
    let takeoutSnapshot: any = null;
    try {
      const bookingId = String(data?.id ?? "");
      const vid = String(vendor_id || "").trim();
      const itemsIn = (Array.isArray((body as any)?.items) ? (body as any).items : []) as any[];

      if (!vid || !itemsIn.length) {
        takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Missing vendor_id or items[]" };
      } else {
        const rows: any[] = [];
        let subtotal = 0;

        for (const it of itemsIn) {
          const mid = String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || "").trim() || null;
          const name = String(it?.name || "").trim();
          const price = Number(it?.price ?? 0);
          const qty = Math.max(1, parseInt(String(it?.quantity ?? it?.qty ?? 1), 10) || 1);

          if (!name) continue;

          rows.push({
            booking_id: bookingId,
            menu_item_id: mid,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity: qty,
            snapshot_at: new Date().toISOString(),
          });

          subtotal += (Number.isFinite(price) ? price : 0) * qty;
        }

        if (!rows.length) {
          takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "No valid items to snapshot" };
        } else {
          const insItems = await admin.from("takeout_order_items").insert(rows);
          if (insItems?.error) {
            takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Insert failed: " + insItems.error.message };
          } else {
            // lock totals onto booking
            const up = await admin
              .from("bookings")
              .update({ service_type: "takeout", takeout_items_subtotal: subtotal })
              .eq("id", bookingId);

            takeoutSnapshot = {
              ok: !up?.error,
              inserted: rows.length,
              subtotal,
              note: up?.error ? ("Subtotal update failed: " + up.error.message) : "OK",
            };
          }
        }
      }
    } catch (e: any) {
      takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Snapshot exception: " + String(e?.message || e) };
    }

    return json(200, { ok: true, action: "created", order_id: data?.id ?? null, takeoutSnapshot });
'@

$a = $a.Replace($needleReturn, $replacementReturn)

WriteUtf8NoBom $api $a
OK "Patched $api (create now snapshots items + locks subtotal)."

OK "DONE: Phase 2D wiring patch applied."
