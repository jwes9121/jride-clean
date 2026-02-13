param(
  [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$target = Join-Path (Resolve-Path $RepoRoot) "app\api\passenger\track\route.ts"
if (-not (Test-Path $target)) { Fail "[FAIL] Missing file: $target" }

$bakDir = Join-Path (Resolve-Path $RepoRoot) "_patch_bak"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("passenger.track.route.ts.bak.TYPEFIX_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$content = Get-Content -LiteralPath $target -Raw

# Remove previous broken guard blocks if they exist
$content2 = $content
$content2 = [regex]::Replace($content2, "(?s)\r?\n\s*//\s*===\s*JRIDE_TRACK_TYPE_GUARD_V1\s*===.*?//\s*===\s*END\s*JRIDE_TRACK_TYPE_GUARD_V1\s*===\s*\r?\n", "`r`n")
$content2 = [regex]::Replace($content2, "(?s)\r?\n\s*//\s*===\s*JRIDE_TRACK_TYPE_GUARD_V\d+\s*===.*?//\s*===\s*END\s*JRIDE_TRACK_TYPE_GUARD_V\d+\s*===\s*\r?\n", "`r`n")

if ($content2 -ne $content) { Ok "[OK] Removed old JRIDE_TRACK_TYPE_GUARD blocks." }

$content = $content2

# Ensure we have a safe cast before driverId access
# Replace: const driverId = (booking.driver_id || booking.assigned_driver_id) ...
# with:    const bookingRow: any = booking as any; const driverId = ...
$pattern = 'const\s+driverId\s*=\s*\(\s*booking\.driver_id\s*\|\|\s*booking\.assigned_driver_id\s*\)\s*as\s*string\s*\|\s*null\s*;'
if ([regex]::IsMatch($content, $pattern)) {
  $replacement = @'
const bookingRow: any = booking as any;
  const driverId = (bookingRow.driver_id || bookingRow.assigned_driver_id) as string | null;
'@
  $content = [regex]::Replace($content, $pattern, [regex]::Escape($replacement) -replace '\\r\\n', "`r`n")
  Ok "[OK] Patched driverId line to use bookingRow:any."
} else {
  # If the exact line isn't found, inject bookingRow:any right after the booking fetch check
  $anchor = 'if\s*\(\s*error\s*\|\|\s*!booking\s*\)\s*\{'
  if ([regex]::IsMatch($content, $anchor)) {
    $content = [regex]::Replace(
      $content,
      $anchor,
      { param($m) $m.Value + "`r`n`r`n  const bookingRow: any = booking as any;`r`n" },
      1
    )
    Ok "[OK] Injected bookingRow:any after (error || !booking) guard."
  } else {
    Warn "[WARN] Could not find (error || !booking) guard to inject bookingRow:any. No injection performed."
  }
}

Set-Content -LiteralPath $target -Value $content -Encoding UTF8
Ok ("[OK] Wrote: {0}" -f $target)
