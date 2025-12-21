# PATCH-LIVETRIPS-DROPDOWN-ASCII-NOBOM.ps1
# Forces driver dropdown label to ASCII-only separators (no — • …), and saves UTF-8 NO-BOM.
# This permanently prevents â€” â€¢ showing up.
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# 1) If a helper exists, rewrite it to ASCII-only output.
if ($txt -match '(?s)function\s+formatDriverOptionLabel\s*\([^\)]*\)\s*\{[\s\S]*?\}') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)function\s+formatDriverOptionLabel\s*\([^\)]*\)\s*\{[\s\S]*?\}',
@'
function formatDriverOptionLabel(d: any, idx: number) {
  const id = String(d?.driver_id || d?.id || d?.uuid || "");
  const full = id || "";
  const short = full ? full.slice(0, 8) : String(idx + 1);
  const displayName = d?.name ? String(d.name) : `Driver ${short}`;
  const town = d?.town ? String(d.town) : "";
  const status = d?.status ? String(d.status) : "";
  // ASCII-only separators to prevent mojibake (no — • …)
  return `${displayName} - ${full || short}${town ? ` - ${town}` : ""}${status ? ` - ${status}` : ""}`.trim();
}
'@,
    1
  )
} else {
  # 2) Otherwise, patch common inline label patterns to ASCII-only.
  # Replace any occurrences of em dash / bullet / mojibake tokens in this file.
  $txt = $txt.Replace("â€”", " - ").Replace("â€¢", " - ").Replace("â€¦", "...")
  $txt = $txt.Replace([string]([char]0x2014), " - ")  # —
  $txt = $txt.Replace([string]([char]0x2022), " - ")  # •
  $txt = $txt.Replace([string]([char]0x2026), "...")  # …
}

# Also normalize any accidental double separators
$txt = $txt -replace '\s+-\s+', ' - '

if ($txt -eq $orig) {
  Fail "No changes applied. Could not find formatDriverOptionLabel() and no mojibake tokens were present. Paste the dropdown code block from LiveTripsClient.tsx and I'll target it exactly."
}

Write-Utf8NoBom $f $txt
Write-Host "OK: LiveTripsClient dropdown label forced to ASCII-only + saved UTF-8 NO-BOM." -ForegroundColor Green

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Stop dev server (Ctrl+C)" -ForegroundColor White
Write-Host "2) npm run dev" -ForegroundColor White
Write-Host "3) Browser hard refresh (Ctrl+Shift+R)" -ForegroundColor White
