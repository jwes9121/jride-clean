# PATCH-JRIDE_RIDE_DROPOFF_UNLOCK_V3.ps1
# Fixes PS Regex.Replace overload issue by using Regex objects.
# Continues safely even if V2 already applied steps 1-4.

$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"

if (!(Test-Path $target)) {
  throw "File not found: $target`nRun this script from your repo root."
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Ok "Backup: $bak"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$txt = [System.IO.File]::ReadAllText($target, $utf8NoBom)

# ---------- Step 5: Require destination before allowSubmit ----------
# We append destination requirements right before the FIRST semicolon of allowSubmit assignment.
# Use Regex object to avoid overload mismatch.
$before = $txt
$pattern = '(const\s+allowSubmit\s*=\s*[\s\S]*?)(;)'
$repl    = '$1 && !!String(toLabel || "").trim() && (numOrNull(dropLat) !== null) && (numOrNull(dropLng) !== null)$2'

$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
$txt = $rx.Replace($txt, $repl, 1)

if ($txt -eq $before) {
  Write-Warn "Could not update allowSubmit (pattern not found). Continuing."
} else {
  Write-Ok "Added destination-required gate to allowSubmit."
}

# ---------- Step 6: Insert hint under Dropoff label input (best-effort) ----------
$hint = @'
            {!String(toLabel || "").trim() ? (
              <div className="mt-1 text-[11px] text-amber-900/70">
                Set a destination (drop-off) to enable Submit booking.
              </div>
            ) : null}
'@

$before = $txt
$pattern2 = '(label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Dropoff label</label>\s*\r?\n\s*<input[\s\S]*?\/>\s*)'
$rx2 = New-Object System.Text.RegularExpressions.Regex($pattern2, [System.Text.RegularExpressions.RegexOptions]::Multiline)
$txt = $rx2.Replace($txt, ('$1' + "`r`n" + $hint), 1)

if ($txt -eq $before) {
  Write-Warn "Did not insert dropoff hint (pattern not found). Continuing."
} else {
  Write-Ok "Inserted dropoff hint under Dropoff label input."
}

# Write back
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Write-Ok "Patched: $target"

Write-Info "Now run: npm.cmd run build"
