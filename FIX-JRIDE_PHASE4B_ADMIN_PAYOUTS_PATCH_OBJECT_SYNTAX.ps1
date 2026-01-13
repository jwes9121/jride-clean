# FIX-JRIDE_PHASE4B_ADMIN_PAYOUTS_PATCH_OBJECT_SYNTAX.ps1
# Fixes route.ts syntax where "const patch" line is commented but object body remains.
# Does NOT add any wallet logic. Only restores valid "const patch" block.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host $m -ForegroundColor Green }
function Info($m) { Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\driver-payouts\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target`nRun this script from repo root."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# Find the broken area
$needle = "// const patch: any = {"
$idx = $txt.IndexOf($needle, [System.StringComparison]::Ordinal)
if ($idx -lt 0) {
  Fail "Could not find the broken commented line:`n$needle`nNo changes made."
}

# From that point, find the first occurrence of the closing '};' after it
$closeNeedle = "};"
$closeIdx = $txt.IndexOf($closeNeedle, $idx, [System.StringComparison]::Ordinal)
if ($closeIdx -lt 0) {
  Fail "Could not find closing '};' after the broken patch block. No changes made."
}

# Expand closeIdx to include the full closing line break(s)
$afterClose = $closeIdx + $closeNeedle.Length
while ($afterClose -lt $txt.Length) {
  $ch = $txt[$afterClose]
  if ($ch -eq "`r" -or $ch -eq "`n") { $afterClose++ } else { break }
}

# Replace the entire broken block with a correct patch block
$replacement = @"
const patch: any = {
      status: targetStatus,
      processed_at: new Date().toISOString(),
    };

"@

$before = $txt.Substring(0, $idx)
$after  = $txt.Substring($afterClose)
$out = $before + $replacement + $after

# Sanity check: ensure we now have "const patch" not commented
if ($out -notmatch "const patch:\s*any\s*=\s*\{") {
  Fail "Patch block did not apply as expected. No output written."
}

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $out, $utf8NoBom)

Ok "[OK] Fixed syntax: restored const patch object"
Info "File: $target"
Ok "[DONE]"
