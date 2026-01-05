# FIX-JRIDE_VENDOR_CORE_V3_UI_SYNC_RECOVER_ALL.ps1
# Vendor Core V3: Ensure mergeUpdatedOrder exists + wire setOrders to use it (flex)
# File: app/vendor-orders/page.tsx
# One file only. No gating. No manual edits.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# 1) Ensure mergeUpdatedOrder helper exists
if ($txt -notmatch "VENDOR_CORE_V3_UI_SYNC") {
  # Insert after updatingId state if present, otherwise after first useState block
  $anchor = '(?m)^\s*const\s*\[\s*updatingId\s*,\s*setUpdatingId\s*\]\s*=\s*useState<.*?>\(\s*null\s*\);\s*$'
  if ($txt -notmatch $anchor) {
    $anchor = '(?m)^\s*const\s*\[.*?\]\s*=\s*useState<.*?>\(.+?\);\s*$'
    if ($txt -notmatch $anchor) { Fail "Could not find a useState anchor to insert helper after." }
  }

  $helper = @'

  // VENDOR_CORE_V3_UI_SYNC
  // Merge backend-confirmed order into existing list safely
  function mergeUpdatedOrder(prev: VendorOrder[], updated: VendorOrder) {
    return prev.map((o) => {
      if (o.id !== updated.id) return o;
      return {
        ...o,
        status: updated.status,
        totalBill: updated.totalBill,
        customerName: updated.customerName,
        bookingCode: updated.bookingCode,
        createdAt: updated.createdAt,
      };
    });
  }

'@

  $txt = [regex]::Replace($txt, $anchor, '$0' + $helper, 1)
  Ok "Inserted mergeUpdatedOrder helper."
} else {
  Info "VENDOR_CORE_V3_UI_SYNC marker already present (helper likely exists)."
}

# 2) Wire setOrders to mergeUpdatedOrder(prev, updated) (flex)
# Replace FIRST setOrders statement that references 'updated' with the merge call.
$setOrdersWithUpdated = '(?s)\bsetOrders\s*\(\s*.*?updated.*?\)\s*;'
if ([regex]::IsMatch($txt, $setOrdersWithUpdated)) {
  $txt = [regex]::Replace(
    $txt,
    $setOrdersWithUpdated,
    'setOrders((prev) => mergeUpdatedOrder(prev, updated));',
    1
  )
  Ok "Replaced setOrders(...) referencing updated with mergeUpdatedOrder(prev, updated)."
} else {
  # If no setOrders(updated...) exists, try inserting after "const updated = ..."
  $updatedLinePat = '(?m)^\s*const\s+updated\s*=\s*.+;\s*$'
  if ($txt -match $updatedLinePat) {
    $txt = [regex]::Replace(
      $txt,
      $updatedLinePat,
      '$0' + "`r`n" + '      setOrders((prev) => mergeUpdatedOrder(prev, updated));',
      1
    )
    Ok "Inserted merge setOrders call after 'const updated = ...;'"
  } else {
    # fallback: updatedOrder
    $updatedLinePat2 = '(?m)^\s*const\s+updatedOrder\s*=\s*.+;\s*$'
    if ($txt -match $updatedLinePat2) {
      $txt = [regex]::Replace(
        $txt,
        $updatedLinePat2,
        '$0' + "`r`n" + '      setOrders((prev) => mergeUpdatedOrder(prev, updatedOrder as any));',
        1
      )
      Ok "Inserted merge setOrders call after 'const updatedOrder = ...;'"
    } else {
      Fail "Could not find a setOrders(...) referencing updated OR an 'updated' variable. Paste the handleStatusUpdate function from app/vendor-orders/page.tsx."
    }
  }
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Vendor Core V3 UI sync recovery applied."
