# PATCH-PHASE3I_VENDOR_ORDERS_POSTCREATE_FORCE_COORDS_V2.ps1
# PS5.1-compatible write (no Set-Content -NoNewline).
# Injects a post-create update to force pickup/dropoff coords.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing $target" }

$src  = [System.IO.File]::ReadAllText((Resolve-Path $target), [System.Text.Encoding]::UTF8)

$anchor = 'const bookingId = String(ins.data?.id ?? "");'
if ($src.IndexOf($anchor) -lt 0) { Fail "bookingId anchor not found: $anchor" }

# Prevent double-insert if re-run
if ($src.IndexOf("PHASE3I_FORCE_POSTCREATE_COORDS") -ge 0) {
  Fail "Patch already present (PHASE3I_FORCE_POSTCREATE_COORDS). Nothing to do."
}

$inject = @'
  // PHASE3I_FORCE_POSTCREATE_COORDS
  try {
    const forcePayload: Record<string, any> = {
      vendor_id,
      pickup_lat: (vendorLL as any)?.lat ?? null,
      pickup_lng: (vendorLL as any)?.lng ?? null,
      dropoff_lat: (dropoffLL as any)?.lat ?? null,
      dropoff_lng: (dropoffLL as any)?.lng ?? null,
      town: derivedTown ?? null,
    };

    await admin.from("bookings").update(forcePayload).eq("id", bookingId);
  } catch {}
  // PHASE3I_FORCE_POSTCREATE_COORDS_END
'@

$replacement = $anchor + "`r`n`r`n" + $inject + "`r`n"
$src2 = $src.Replace($anchor, $replacement)

if ($src2 -eq $src) { Fail "Injection failed (no change). Paste the bookingId line from route.ts." }

$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

[System.IO.File]::WriteAllText((Resolve-Path $target), $src2, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"
Ok "Injected post-create force coords update."
