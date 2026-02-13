# FIX-JRIDE_PHASE11C_RIDE_VERIFY_HELPER_PLACEMENT.ps1
# Repairs app/ride/page.tsx after bad injection:
# - Removes the broken "function verificationStatusLabel" block (if present)
# - Re-inserts it after the full normUpper() function block
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = Join-Path (Get-Location) "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Remove any existing verificationStatusLabel function (broken or not)
$txt = [regex]::Replace(
  $txt,
  "(?s)\r?\n\s*function\s+verificationStatusLabel\s*\(.*?\)\s*:\s*string\s*\{.*?\}\r?\n",
  "`r`n"
)

# 2) Find the END of function normUpper(...) { ... } and insert after it
$match = [regex]::Match(
  $txt,
  "(?s)function\s+normUpper\s*\(\s*[^)]*\)\s*:\s*string\s*\{.*?\}\s*"
)
if (-not $match.Success) {
  Fail "Could not locate full normUpper(...) { ... } block."
}

$insertPos = $match.Index + $match.Length

$helper = @'

function verificationStatusLabel(info: any): string {
  if (!info) return "Not submitted";
  if (info.verified === true) return "Verified";
  const note = String(info.verification_note || "").toLowerCase();
  if (note.indexOf("pre_approved_dispatcher") >= 0) return "Pending admin approval";
  if (note.indexOf("dispatcher") >= 0) return "Pending admin approval";
  if (note) return "Submitted (dispatcher review)";
  return "Not submitted";
}

'@

# Only insert if not already present
if ($txt -notmatch "function\s+verificationStatusLabel") {
  $txt = $txt.Insert($insertPos, $helper)
}

# 3) ASCII cleanup (defensive)
$txt = $txt.Replace([char]0x2019, "'").Replace([char]0x2018, "'")
$txt = $txt.Replace([char]0x2014, "-").Replace([char]0x2013, "-")

if ($txt -eq $orig) {
  Fail "No changes produced (unexpected)."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::ASCII)
Ok "Fixed: $target"
Info "Now run npm build."
