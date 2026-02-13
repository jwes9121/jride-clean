# PATCH-FIX-LIVETRIPSCLIENT-FORMATDRIVERLABEL.ps1
# Fixes LiveTripsClient.tsx compile error by rewriting formatDriverOptionLabel() block cleanly.
# ASCII-only separators to prevent mojibake.
# Writes UTF-8 NO-BOM to avoid encoding re-corruption.

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

# Replace entire function formatDriverOptionLabel(...) { ... } with a clean version.
# We anchor it up to the next "type DriverRow" (seen in your screenshot) to avoid partial matches.
$pattern = '(?s)function\s+formatDriverOptionLabel\s*\([^\)]*\)\s*\{.*?\}\s*(?=\s*type\s+DriverRow\b)'
if ($txt -notmatch $pattern) {
  Fail "Could not find formatDriverOptionLabel(...) block anchored before 'type DriverRow'. Paste lines 50-90 of LiveTripsClient.tsx if this fails."
}

$replacement = @'
function formatDriverOptionLabel(d: any, idx: number) {
  const id = String(d?.driver_id || d?.id || d?.uuid || "");
  const full = id || "";
  const short = full ? full.slice(0, 8) : String(idx + 1);
  const displayName = d?.name ? String(d.name) : `Driver ${short}`;
  const town = d?.town ? String(d.town) : "";
  const status = d?.status ? String(d.status) : "";
  // ASCII-only separators (prevents mojibake)
  return `${displayName} - ${full || short}${town ? ` - ${town}` : ""}${status ? ` - ${status}` : ""}`.trim();
}

'@

$txt = [regex]::Replace($txt, $pattern, $replacement, 1)

# As a safety net, remove any leftover mojibake tokens in this file (won't affect valid code)
$txt = $txt.Replace("-", " - ").Replace("â€¢", " - ").Replace("â€¦", "...")
$txt = $txt -replace '\s+-\s+', ' - '

if ($txt -eq $orig) { Fail "No changes made (unexpected). Aborting." }

Write-Utf8NoBom $f $txt
Write-Host "OK: Rewrote formatDriverOptionLabel() and fixed encoding (UTF-8 NO-BOM)." -ForegroundColor Green
Write-Host "Next: restart dev server + hard refresh." -ForegroundColor Cyan
