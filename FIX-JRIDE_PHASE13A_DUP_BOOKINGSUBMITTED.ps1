# FIX-JRIDE_PHASE13A_DUP_BOOKINGSUBMITTED.ps1
# Fix: remove duplicate `bookingSubmitted` definition in app/ride/page.tsx
# One file only. No manual edits.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

$repoRoot = (Get-Location).Path
$rel = "app\ride\page.tsx"
$path = Join-Path $repoRoot $rel

if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Replace any immediate duplicate of the exact line with a single instance.
# This targets the common case:
#   const bookingSubmitted = !!activeCode;
#   const bookingSubmitted = !!activeCode;
$pattern = "(?m)^[ \t]*const[ \t]+bookingSubmitted[ \t]*=[ \t]*!!activeCode;[ \t]*\r?\n[ \t]*const[ \t]+bookingSubmitted[ \t]*=[ \t]*!!activeCode;[ \t]*\r?\n"
$repl = "  const bookingSubmitted = !!activeCode;`r`n"

$before = [regex]::Matches($txt, $pattern).Count
if ($before -eq 0) {
  # Fallback: if duplicates exist but not adjacent (rare), collapse all occurrences to one by removing the later ones
  $all = [regex]::Matches($txt, "(?m)^[ \t]*const[ \t]+bookingSubmitted[ \t]*=[ \t]*!!activeCode;[ \t]*\r?\n").Count
  if ($all -le 1) { Fail "No duplicate bookingSubmitted found to fix." }

  $seen = $false
  $txt2 = [regex]::Replace($txt, "(?m)^[ \t]*const[ \t]+bookingSubmitted[ \t]*=[ \t]*!!activeCode;[ \t]*\r?\n", {
    param($m)
    if (-not $seen) { $seen = $true; return $m.Value }
    return ""
  })
  $txt = $txt2
  Ok "Removed extra bookingSubmitted declarations (non-adjacent fallback)."
} else {
  $txt = [regex]::Replace($txt, $pattern, $repl, 1)
  Ok "Removed adjacent duplicate bookingSubmitted declaration."
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
