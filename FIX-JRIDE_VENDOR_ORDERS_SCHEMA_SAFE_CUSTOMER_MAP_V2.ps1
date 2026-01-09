$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\api\vendor-orders\route.ts'

if (!(Test-Path $path)) { Fail "route.ts not found at app\api\vendor-orders\route.ts (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

# Locate the specific insert block for bookings in POST create path
# We replace the OBJECT inside .insert({ ... }) without touching the rest of the chain.
$pattern = '(?s)\.from\(\s*["'']bookings["'']\s*\)\s*\.insert\(\s*\{.*?\}\s*\)\s*\.select'
if ($txt -notmatch $pattern) {
  Fail "Could not locate bookings.insert({ ... }).select block in route.ts (file differs from expected)."
}

$replacement = @'
.from("bookings")
    .insert({
      vendor_id,
      service_type: "takeout",
      vendor_status,
      status: "requested",

      rider_name: customer_name || null,
      rider_phone: customer_phone || null,

      to_label: to_label || null,
      note: note || null,
      items_text: items_text || null,
      takeout_items_subtotal: subtotal,
    })
    .select
'@

$new = [regex]::Replace($txt, $pattern, $replacement, 1)

if ($new -eq $txt) { Fail "Replacement did not apply (no changes made)." }

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8)

Ok "[OK] Patched: customer_* mapped to rider_* in bookings insert (schema-safe)."
Info "NEXT: npm run build"
