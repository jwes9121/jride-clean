$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\api\vendor-orders\route.ts'
if (!(Test-Path $path)) { Fail "Missing: app\api\vendor-orders\route.ts (run from repo root)" }

# Backup first
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

# Find the bookings insert().select block (CREATE path)
$pattern = '(?s)\.from\(\s*["'']bookings["'']\s*\)\s*\.insert\(\s*\{.*?\}\s*\)\s*\.select'
if ($txt -notmatch $pattern) {
  Fail "Could not locate the bookings.insert({ ... }).select block. The file format differs from expected."
}

# Replace ONLY the insert object (schema-safe)
$replacement = @'
.from("bookings")
    .insert({
      vendor_id,
      service_type: "takeout",
      vendor_status,
      status: "requested",

      rider_name: customer_name || null,
      rider_phone: customer_phone || null,

      // Map delivery address to existing schema (dropoff_label is common in bookings)
      dropoff_label: to_label || null,

      // Phase 2D requirement
      takeout_items_subtotal: subtotal,
    })
    .select
'@

$new = [regex]::Replace($txt, $pattern, $replacement, 1)
if ($new -eq $txt) { Fail "Replacement did not apply (no changes made)." }

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8)

Ok "[OK] Patched bookings insert: removed items_text/note/to_label, mapped address to dropoff_label."
Info "NEXT: npm run build"
