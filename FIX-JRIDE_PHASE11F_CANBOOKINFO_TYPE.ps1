# FIX-JRIDE_PHASE11F_CANBOOKINFO_TYPE.ps1
# Adds verification_status fields to CanBookInfo type in app/ride/page.tsx
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

# Locate CanBookInfo type block and insert fields if missing
$blockRegex = "(?s)type\s+CanBookInfo\s*=\s*\{.*?\n\};"
$m = [regex]::Match($txt, $blockRegex)
if (-not $m.Success) { Fail "Could not find type CanBookInfo = { ... };" }

$block = $m.Value

if ($block -notmatch "verification_status") {
  # Insert near other verification fields if possible; otherwise append before closing brace.
  $insertPoint = [regex]::Match($block, "(?m)^\s*verification_note\?\s*:\s*.*$")

  if ($insertPoint.Success) {
    $block2 = [regex]::Replace(
      $block,
      "(?m)^\s*verification_note\?\s*:\s*.*$",
      '$0' + "`r`n  verification_status?: string | null;`r`n  verification_raw_status?: string | null;"
    )
  } else {
    $block2 = $block -replace "\n\};", "`r`n  verification_status?: string | null;`r`n  verification_raw_status?: string | null;`r`n};"
  }

  $txt = $txt.Substring(0, $m.Index) + $block2 + $txt.Substring($m.Index + $m.Length)
}

if ($txt -eq $orig) { Fail "No changes produced (already applied?)." }

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Patched CanBookInfo type: added verification_status fields."
