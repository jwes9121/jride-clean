# PATCH-PHASE3I_VENDOR_ORDERS_FIX_FORCEPAYLOAD_COORDS.ps1
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Info($m){ Write-Host $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repo "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Info "[OK] Backup: $bak"

$txt = [IO.File]::ReadAllText($target, [Text.Encoding]::UTF8)

# Match any "const forcePayload: Record<string, any> = { ... };"
$re = New-Object System.Text.RegularExpressions.Regex(
  "(?s)const\s+forcePayload\s*:\s*Record\s*<\s*string\s*,\s*any\s*>\s*=\s*\{.*?\};",
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

$matchCount = $re.Matches($txt).Count
if ($matchCount -le 0) {
  Fail "No forcePayload blocks found. Search for 'const forcePayload' in app\api\vendor-orders\route.ts and paste that section."
}

$changed = 0

$fixed = $re.Replace($txt, {
  param($m)

  $block = $m.Value

  # Force these 4 lines inside the object (replace whatever expression is there)
  $orig = $block

  $block = [System.Text.RegularExpressions.Regex]::Replace(
    $block, "(?m)^\s*pickup_lat\s*:\s*[^,]*,\s*$",
    "      pickup_lat: (pickupLL as any)?.lat ?? null,"
  )
  $block = [System.Text.RegularExpressions.Regex]::Replace(
    $block, "(?m)^\s*pickup_lng\s*:\s*[^,]*,\s*$",
    "      pickup_lng: (pickupLL as any)?.lng ?? null,"
  )
  $block = [System.Text.RegularExpressions.Regex]::Replace(
    $block, "(?m)^\s*dropoff_lat\s*:\s*[^,]*,\s*$",
    "      dropoff_lat: (dropoffLL as any)?.lat ?? null,"
  )
  $block = [System.Text.RegularExpressions.Regex]::Replace(
    $block, "(?m)^\s*dropoff_lng\s*:\s*[^,]*,\s*$",
    "      dropoff_lng: (dropoffLL as any)?.lng ?? null,"
  )

  if ($block -ne $orig) { $script:changed++ }
  return $block
})

if ($changed -le 0) {
  Fail "No changes applied inside forcePayload blocks (pickup/dropoff lines not found). Paste the forcePayload object block so I can match your exact formatting."
}

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($target, $fixed, $utf8NoBom)

Info "[OK] Patched $changed forcePayload block(s)."
Info "[OK] Target: $target"
Info "[NEXT] Run build, then re-test vendor-orders create. If DB still shows 0/0, we will check DB trigger/function or schema defaults."
