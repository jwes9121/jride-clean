# FIX-JRIDE_VENDOR_SAMPLES_CANONICAL_CASE_V1_PS5SAFE.ps1
# Fix Vercel/Linux case sensitivity:
# Convert tracked files:
#   Hamburger.jpg  -> hamburger.jpg
#   Milktea.jpg    -> milktea.jpg
#   Pinapaitan.jpg -> pinapaitan.jpg
# Uses git mv via a temp name because Windows is case-insensitive.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

# Ensure we're in a git repo
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Die "Not inside a git repo. cd to: C:\Users\jwes9\Desktop\jride-clean-fresh" }

$base = "public/vendor-samples"

# Map of wrong->right (case only)
$renames = @(
  @{ from = "$base/Hamburger.jpg";  to = "$base/hamburger.jpg"  },
  @{ from = "$base/Milktea.jpg";    to = "$base/milktea.jpg"    },
  @{ from = "$base/Pinapaitan.jpg"; to = "$base/pinapaitan.jpg" }
)

function GitMvCaseSafe($from, $to) {
  # If source isn't tracked, skip
  $tracked = git ls-files -- "$from"
  if ([string]::IsNullOrWhiteSpace($tracked)) {
    Warn "[WARN] Not tracked (skip): $from"
    return
  }

  # If target already exists/tracked, fail to avoid collisions
  $trackedTo = git ls-files -- "$to"
  if (-not [string]::IsNullOrWhiteSpace($trackedTo)) {
    Die "Target already tracked: $to`nResolve collision first."
  }

  # Temp name to force case change on Windows
  $tmp = $to + ".tmp_casefix_" + ([Guid]::NewGuid().ToString("N").Substring(0,8))

  Ok "[OK] git mv -> temp: $from -> $tmp"
  git mv -- "$from" "$tmp"
  if ($LASTEXITCODE -ne 0) { Die "git mv failed: $from -> $tmp" }

  Ok "[OK] git mv -> final: $tmp -> $to"
  git mv -- "$tmp" "$to"
  if ($LASTEXITCODE -ne 0) { Die "git mv failed: $tmp -> $to" }
}

foreach ($r in $renames) {
  GitMvCaseSafe $r.from $r.to
}

# Sanity: list tracked files after fix
Ok "[OK] Tracked vendor-samples after fix:"
git ls-files "public/vendor-samples" | ForEach-Object { Write-Host " - $_" }

Ok "[DONE] Case-fix complete. Next: commit + push."
