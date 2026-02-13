# PATCH-JRIDE_PHASE2D_VENDOR_ORDERS_DEBUG_KEYS.ps1
# Phase 2D: Improve takeoutSnapshot debug output in app/api/vendor-orders/route.ts
# - No auth changes
# - No wallet logic
# - Backup first
# - UTF-8 no BOM

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

$path = "app\api\vendor-orders\route.ts"
if (!(Test-Path $path)) { FAIL "Missing $path" }

$bak = "$path.bak.$(TS)"
Copy-Item -Force $path $bak
OK "Backup: $bak"

$txt = Get-Content -Raw $path

# We patch the note returned when items/vendor_id are missing inside phase2dSnapshotTakeout()
# Find the exact line that returns the "Missing vendor_id or items[]" note.
$needle = 'return { ok: false, inserted: 0, subtotal: 0, note: "Missing vendor_id or items\[\]" };'
if ($txt -notmatch [regex]::Escape($needle)) {
  # Some versions have slightly different whitespace; try a regex match.
  $rx = [regex]::new('return\s*\{\s*ok\s*:\s*false\s*,\s*inserted\s*:\s*0\s*,\s*subtotal\s*:\s*0\s*,\s*note\s*:\s*"Missing vendor_id or items\[\]"\s*\}\s*;')
  if (-not $rx.IsMatch($txt)) {
    FAIL "Could not find the 'Missing vendor_id or items[]' return in phase2dSnapshotTakeout(). Paste that helper if it differs."
  }

  $replacement = @'
    const _keys = Object.keys(body || {}).slice(0, 40);
    const _cands: any = {
      items: Array.isArray((body as any)?.items) ? (body as any).items.length : 0,
      cart: Array.isArray((body as any)?.cart) ? (body as any).cart.length : 0,
      order_items: Array.isArray((body as any)?.order_items) ? (body as any).order_items.length : 0,
      takeout_items: Array.isArray((body as any)?.takeout_items) ? (body as any).takeout_items.length : 0,
      menu_snapshot: Array.isArray((body as any)?.menu_snapshot) ? (body as any).menu_snapshot.length : 0,
      cartItems: Array.isArray((body as any)?.cartItems) ? (body as any).cartItems.length : 0,
      orderItems: Array.isArray((body as any)?.orderItems) ? (body as any).orderItems.length : 0,
      selectedItems: Array.isArray((body as any)?.selectedItems) ? (body as any).selectedItems.length : 0,
      snapshot: Array.isArray((body as any)?.snapshot) ? (body as any).snapshot.length : 0
    };
    return {
      ok: false,
      inserted: 0,
      subtotal: 0,
      note: "Missing vendor_id or items[]. keys=" + JSON.stringify(_keys) + " cands=" + JSON.stringify(_cands),
    };
'@

    $txt = $rx.Replace($txt, $replacement, 1)
    OK "Patched missing-items note with received keys + candidate counts."
} else {
  # exact-string match path
  $replacement = @'
    const _keys = Object.keys(body || {}).slice(0, 40);
    const _cands: any = {
      items: Array.isArray((body as any)?.items) ? (body as any).items.length : 0,
      cart: Array.isArray((body as any)?.cart) ? (body as any).cart.length : 0,
      order_items: Array.isArray((body as any)?.order_items) ? (body as any).order_items.length : 0,
      takeout_items: Array.isArray((body as any)?.takeout_items) ? (body as any).takeout_items.length : 0,
      menu_snapshot: Array.isArray((body as any)?.menu_snapshot) ? (body as any).menu_snapshot.length : 0,
      cartItems: Array.isArray((body as any)?.cartItems) ? (body as any).cartItems.length : 0,
      orderItems: Array.isArray((body as any)?.orderItems) ? (body as any).orderItems.length : 0,
      selectedItems: Array.isArray((body as any)?.selectedItems) ? (body as any).selectedItems.length : 0,
      snapshot: Array.isArray((body as any)?.snapshot) ? (body as any).snapshot.length : 0
    };
    return {
      ok: false,
      inserted: 0,
      subtotal: 0,
      note: "Missing vendor_id or items[]. keys=" + JSON.stringify(_keys) + " cands=" + JSON.stringify(_cands),
    };
'@
  $txt = $txt.Replace($needle, $replacement)
  OK "Patched missing-items note with received keys + candidate counts."
}

WriteUtf8NoBom $path $txt
OK "Wrote: $path (UTF-8 no BOM)"
