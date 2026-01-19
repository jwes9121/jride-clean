# FIX-JRIDE_DRIVER_LOCKED_VAR_SHIM.ps1
# Fix: app/driver/page.tsx references `locked` but it is undefined.
# Adds a safe computed `const locked = ...` before the first return().
# Prefers existing booleans if present; otherwise defaults to false (not locked).
# UTF-8 no BOM, ASCII-only, fail-fast.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function WriteUtf8NoBom($path, $content){
  $dir = Split-Path -Parent $path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($content))
}

$root = (Get-Location).Path
$target = Join-Path $root "app\driver\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt  = Get-Content $target -Raw -Encoding utf8
$orig = $txt

# If locked already exists, stop (avoid duplicates)
if ($txt -match "\bconst\s+locked\b" -or $txt -match "\blet\s+locked\b" -or $txt -match "\bvar\s+locked\b") {
  Fail "locked already exists in app/driver/page.tsx. No changes made."
}

# Ensure it's referenced (otherwise user error differs)
if ($txt -notmatch "\blocked\b") {
  Fail "No `locked` reference found. No changes made."
}

# Insert before first return(
$reReturn = New-Object System.Text.RegularExpressions.Regex("(^[ \t]*return\s*\()", [System.Text.RegularExpressions.RegexOptions]::Multiline)
$rm = $reReturn.Match($txt)
if (-not $rm.Success) { Fail "Could not find `return (` in app/driver/page.tsx" }
$insertPos = $rm.Index

# Heuristic: prefer existing "locked" equivalents if they exist in text
# We do not assume they exist; we just use them if found as identifiers.
$expr = "false"
$preferred = @(
  "walletLocked",
  "isLocked",
  "belowMinLoad",
  "belowMinimumLoad",
  "isBelowMinLoad",
  "cannotGoOnline",
  "cannotSetAvailable"
)

foreach ($name in $preferred) {
  if ($txt -match ("\b" + [regex]::Escape($name) + "\b")) {
    $expr = $name
    break
  }
}

$shim = @"
  // Shim: define `locked` used by availability toggle guardrail (prevents build break)
  // If an existing lock boolean exists, we reuse it; otherwise default to false.
  const locked = Boolean($expr);

"@

$txt2 = $txt.Substring(0, $insertPos) + $shim + $txt.Substring($insertPos)
if ($txt2 -eq $orig) { Fail "No changes applied (unexpected)" }

WriteUtf8NoBom $target $txt2
Write-Host "[OK] Inserted locked shim before return(): $target (locked <- $expr)"

Write-Host ""
Write-Host "Now run:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(driver): add locked shim for availability guard"
Write-Host "  JRIDE_DRIVER_LOCKED_SHIM_GREEN"
