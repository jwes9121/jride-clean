# PATCH-JRIDE_PHASE11C_VERIFY_LABELS_ASCII_SAFE.ps1
# UI-only patch for app/verify/page.tsx:
# - Replace statusLabel() with ASCII-only labels:
#   pending -> Submitted (waiting for dispatcher review)
#   pre_approved_dispatcher -> Pending admin approval
#   approved_admin -> VERIFIED (rides and restricted services allowed)
#   rejected -> REJECTED - check reason and re-submit
# - Update description text to include ride booking
# - Update submit success message to reflect 2-step flow
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = Join-Path (Get-Location) "app\verify\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Update description copy (service-agnostic + includes ride booking)
# Replace only if we see the known intro sentence to avoid accidental edits.
if ($txt -match [regex]::Escape("Upload your ID details so JRide can verify you.")) {
  $txt = $txt -replace "(?s)Upload your ID details so JRide can verify you\.\s*Only verified passengers\s*`r`n\s*can order takeout food and errand services\.",
    "Upload your ID details so JRide can verify you. Verified passengers can book rides and access restricted services."
}

# 2) Replace the entire statusLabel() function with ASCII-only output
$replacementStatusLabel = @'
  const statusLabel = () => {
    if (!current) return "Not submitted";
    switch (current.status) {
      case "pending":
        return "Submitted (waiting for dispatcher review)";
      case "pre_approved_dispatcher":
        return "Pending admin approval";
      case "approved_admin":
        return "VERIFIED (rides and restricted services allowed)";
      case "rejected":
        return "REJECTED - check reason and re-submit";
      default:
        return String(current.status || "");
    }
  };
'@

# Replace the function block by regex anchor
$txt = [regex]::Replace(
  $txt,
  "(?s)\s*const\s+statusLabel\s*=\s*\(\s*\)\s*=>\s*\{.*?\}\s*;\s*",
  "`r`n$replacementStatusLabel`r`n",
  "Singleline"
)

# 3) Update submit success message (ASCII)
$txt = $txt -replace [regex]::Escape('setMessage("Verification submitted. Dispatcher/Admin will review your ID.");'),
  'setMessage("Verification submitted. Dispatcher will review first, then Admin will verify.");'

# 4) Ensure output is ASCII-safe (convert common smart chars defensively)
$txt = $txt.Replace([char]0x2019, "'").Replace([char]0x2018, "'").Replace([char]0x201C, '"').Replace([char]0x201D, '"')
$txt = $txt.Replace([char]0x2014, "-").Replace([char]0x2013, "-")

if ($txt -eq $orig) {
  Fail "No changes produced. Paste the top 120 lines of app\verify\page.tsx."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::ASCII)
Ok "Patched: $target"
Info "Done. Run npm build next."
