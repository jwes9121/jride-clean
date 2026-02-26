param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Path([string]$p, [string]$label) {
  if (!(Test-Path -LiteralPath $p)) {
    throw ("Missing " + $label + ": " + $p)
  }
}

$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
Write-Host "== JRIDE Patch: Passenger booking INSERT forces status=requested (V1 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host ("RepoRoot: " + $repo)

$target = Join-Path $repo "app\api\public\passenger\book\route.ts"
Assert-Path $target "target file"

$bakDir = Join-Path $repo "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak.PASSENGER_BOOK_FORCE_REQUESTED_V1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$src = Get-Content -LiteralPath $target -Raw

function Ensure-Key([string]$objText, [string]$key, [string]$valueLiteral) {
  # Replace existing "key: value"
  $re = "(?s)(^|[,{]\s*)" + [regex]::Escape($key) + "\s*:\s*([^,}]+)"
  if ([regex]::IsMatch($objText, $re)) {
    return [regex]::Replace($objText, $re, ('$1' + $key + ': ' + $valueLiteral))
  }

  # Otherwise insert right after "{"
  return [regex]::Replace(
    $objText,
    "(?s)\{\s*",
    ("{`r`n      " + $key + ": " + $valueLiteral + ",`r`n      "),
    1
  )
}

# Match both single and double quotes in from("bookings") and preserve original quote style
$pattern = "(?s)\.from\(\s*(['""])\s*bookings\s*\1\s*\)\s*\.insert\(\s*(\{.*?\})\s*\)"
$matches = [regex]::Matches($src, $pattern)

if ($matches.Count -lt 1) {
  throw ("Could not find supabase.from('bookings').insert({ ... }) in " + $target)
}

$src2 = $src
$patched = 0

for ($i = $matches.Count - 1; $i -ge 0; $i--) {
  $m = $matches[$i]
  $quote = $m.Groups[1].Value
  $obj   = $m.Groups[2].Value

  # Force fields to satisfy DB constraint and let triggers do auto-assign
  $obj = Ensure-Key $obj "status" '"requested"'
  $obj = Ensure-Key $obj "driver_id" "null"
  $obj = Ensure-Key $obj "assigned_driver_id" "null"
  $obj = Ensure-Key $obj "assigned_at" "null"
  $obj = Ensure-Key $obj "driver_status" "null"

  $replacement = ".from(" + $quote + "bookings" + $quote + ").insert(" + $obj + ")"
  $src2 = $src2.Remove($m.Index, $m.Length).Insert($m.Index, $replacement)
  $patched++
}

Set-Content -LiteralPath $target -Value $src2 -Encoding UTF8
Write-Host ("[OK] Patched: app/api/public/passenger/book/route.ts (patched inserts=" + $patched + ")") -ForegroundColor Green
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Rebuild/redeploy backend." -ForegroundColor Gray
Write-Host "2) Retest passenger Submit booking. It must insert status=requested (no driver yet)." -ForegroundColor Gray
Write-Host ""
Write-Host "[DONE]" -ForegroundColor Green