# PATCH-FIX-DISPATCH-ROW-UNDEFINED-FINAL2.ps1
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

# --- Locate setStatus() ---
$marker = "async function setStatus"
$start = $txt.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { Fail "Could not find 'async function setStatus' in app\dispatch\page.tsx" }

# Find the first '{' after the marker
$open = $txt.IndexOf("{", $start)
if ($open -lt 0) { Fail "Could not find opening '{' for setStatus() block." }

# Brace scan to find matching closing '}'
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
$oldFn  = $txt.Substring($start, ($end - $start + 1))
$after  = $txt.Substring($end + 1)

# --- New setStatus() (NO row possible) ---
$newFn = @"
async function setStatus(booking_id: string, status: string) {
  const res = await fetch("/api/dispatch/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id, status }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Dispatch status update failed:", t);
    alert("Failed to update trip status");
  }
}
"@

# Safety: ensure the new function doesn't contain 'row'
if ($newFn -match "\brow\b") { Fail "Internal error: newFn unexpectedly contains 'row'." }

$out = $before + $newFn + $after
Set-Content -Path $file -Value $out -Encoding UTF8

# Post-check: ensure setStatus() block in file no longer references row
$checkTxt = Get-Content $file -Raw
$checkStart = $checkTxt.IndexOf($marker, [StringComparison]::Ordinal)
if ($checkStart -lt 0) { Fail "Post-check failed: setStatus() marker not found after write." }

$checkOpen = $checkTxt.IndexOf("{", $checkStart)
$checkDepth = 0
$checkEnd = -1
for ($j = $checkOpen; $j -lt $checkTxt.Length; $j++) {
  $c = $checkTxt[$j]
  if ($c -eq "{") { $checkDepth++ }
  elseif ($c -eq "}") {
    $checkDepth--
    if ($checkDepth -eq 0) { $checkEnd = $j; break }
  }
}
if ($checkEnd -lt 0) { Fail "Post-check failed: could not brace-scan setStatus() after write." }

$checkFn = $checkTxt.Substring($checkStart, ($checkEnd - $checkStart + 1))
if ($checkFn -match "\brow\b") { Fail "Patch failed: 'row' still appears inside setStatus() after replacement." }

Write-Host "[OK] Patched setStatus(): removed out-of-scope 'row' completely." -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open /dispatch and click En-route" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
