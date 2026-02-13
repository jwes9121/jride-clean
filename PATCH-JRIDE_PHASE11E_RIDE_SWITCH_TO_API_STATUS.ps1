# PATCH-JRIDE_PHASE11E_RIDE_SWITCH_TO_API_STATUS.ps1
# Phase 11E final:
# - Uses verification_status from can-book API
# - Reuses existing UI line (no JSX structure changes)
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$target = "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Ensure API-based label helper exists
if ($txt -notmatch "function verificationStatusLabelFromApi") {
  $m = [regex]::Match(
    $txt,
    "(?s)function\s+normUpper\s*\([^)]*\)\s*:\s*string\s*\{.*?\}\s*"
  )
  if (-not $m.Success) { Fail "Could not locate normUpper() block." }

  $helper = @'

function verificationStatusLabelFromApi(canInfo: any): string {
  const s = String(canInfo?.verification_status || "").toLowerCase();
  if (!s || s === "not_submitted") return "Not submitted";
  if (s === "submitted") return "Submitted (dispatcher review)";
  if (s === "pending_admin") return "Pending admin approval";
  if (s === "verified") return "Verified";
  if (s === "rejected") return "Rejected";
  return String(canInfo?.verification_status || "");
}

'@
  $pos = $m.Index + $m.Length
  $txt = $txt.Insert($pos, $helper)
}

# 2) Switch the existing UI line to use API-based label
$txt = $txt.Replace(
  "verificationStatusLabel(canInfo)",
  "verificationStatusLabelFromApi(canInfo)"
)

if ($txt -eq $orig) {
  Fail "No changes produced (already applied?)."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Phase 11E applied: ride page now uses verification_status."
