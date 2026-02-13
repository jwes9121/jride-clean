# PATCH-JRIDE_PHASE11C_VERIFY_LABELS_ASCII_FORCE.ps1
# UI-only patch for app/verify/page.tsx:
# - Force replace the description <p> block to include ride booking
# - Force replace statusLabel() with ASCII-only labels for 2-step flow
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

# 1) Replace the description paragraph block (exact class anchor)
$descRegex = '(?s)<p className="text-xs text-gray-600 mb-3">\s*.*?\s*</p>'
$newDesc = @'
<p className="text-xs text-gray-600 mb-3">
        Upload your ID details so JRide can verify you. Verified passengers can book rides and access restricted services.
      </p>
'@

if ($txt -notmatch $descRegex) {
  Fail "Could not find the description <p className=""text-xs text-gray-600 mb-3""> block. Paste the first 80 lines of app\verify\page.tsx."
}
$txt = [regex]::Replace($txt, $descRegex, $newDesc)

# 2) Replace statusLabel() function completely (ASCII only, no emoji)
$statusRegex = '(?s)\s*const\s+statusLabel\s*=\s*\(\s*\)\s*=>\s*\{.*?\}\s*;\s*'
$newStatus = @'
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

if ($txt -notmatch $statusRegex) {
  Fail "Could not find statusLabel() function block. Paste the lines around statusLabel in app\verify\page.tsx."
}
$txt = [regex]::Replace($txt, $statusRegex, "`r`n$newStatus`r`n")

# 3) Replace submit success message (ASCII)
$txt = $txt -replace 'setMessage\("Verification submitted\.[^"]*"\);',
  'setMessage("Verification submitted. Dispatcher will review first, then Admin will verify.");'

# 4) Defensive ASCII cleanup (convert common smart chars)
$txt = $txt.Replace([char]0x2019, "'").Replace([char]0x2018, "'").Replace([char]0x201C, '"').Replace([char]0x201D, '"')
$txt = $txt.Replace([char]0x2014, "-").Replace([char]0x2013, "-")

if ($txt -eq $orig) {
  Fail "No changes produced (unexpected)."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::ASCII)
Ok "Patched: $target"
Info "Done. Run npm build next."
