# PATCH-DISPATCH-STATUS-NORMALIZE-AND-SHOW-ERROR.ps1
$ErrorActionPreference = "Stop"
function Fail($m) { throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content $file -Raw

# Find setStatus()
$marker = "async function setStatus"
$start = $txt.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { Fail "Could not find 'async function setStatus' in $file" }

$open = $txt.IndexOf("{", $start)
if ($open -lt 0) { Fail "Could not find opening '{' for setStatus() block." }

# Brace scan end of function
$depth = 0
$end = -1
for ($i = $open; $i -lt $txt.Length; $i++) {
  $ch = $txt[$i]
  if ($ch -eq "{") { $depth++ }
  elseif ($ch -eq "}") {
    $depth--
    if ($depth -eq 0) { $end = $i; break }
  }
}
if ($end -lt 0) { Fail "Could not find matching closing '}' for setStatus() (brace scan failed)." }

$before = $txt.Substring(0, $start)
$after  = $txt.Substring($end + 1)

# Replace ENTIRE setStatus() with a normalized, API-compatible version
$newFn = @"
async function setStatus(booking_id: string, status: string) {
  // normalize UI status -> API status
  const map: Record<string, string> = {
    enroute: "on_the_way",
    "en-route": "on_the_way",
    en_route: "on_the_way",
    cancel: "cancelled",
  };
  const apiStatus = map[status] ?? status;

  const res = await fetch("/api/dispatch/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId: booking_id, status: apiStatus }),
  });

  const t = await res.text();

  if (!res.ok) {
    console.error("Dispatch status update failed:", t);
    alert("Failed to update trip status: " + t);
    return;
  }

  // If you want, you can refresh data here later. For now we just log.
  console.log("Dispatch status updated:", t);
}
"@

if ($newFn -match "\brow\b") { Fail "Internal error: newFn contains 'row' unexpectedly." }

$out = $before + $newFn + $after
Set-Content -Path $file -Value $out -Encoding UTF8

Write-Host "[OK] Patched setStatus(): normalized statuses + shows server error body in alert." -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) /dispatch -> click En-route" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback if needed:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
