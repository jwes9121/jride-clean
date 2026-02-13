# FIX-JRIDE_ADMIN_CONTROL_CENTER_RESTORE_AND_ROLE_SEPARATOR_SAFE_V5.ps1
# ASCII-only. Restores the latest backup of app/admin/control-center/page.tsx
# then replaces the roleSource template-literal (which contains mojibake) with ASCII-only concatenation.
# Does NOT touch dispatch status. No livetrips edits.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function WriteUtf8NoBom($p,$t){ $enc = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($p,$t,$enc) }
function ReadText($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [System.IO.File]::ReadAllText($p) }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

# 1) Find latest backup
$bakDir = Split-Path -Parent $target
$bakPattern = [System.IO.Path]::GetFileName($target) + ".bak.*"
$baks = Get-ChildItem -LiteralPath $bakDir -Filter $bakPattern -File | Sort-Object LastWriteTime -Descending
if(!$baks -or $baks.Count -eq 0){
  Fail "No backups found next to: $target`nExpected files like page.tsx.bak.YYYYMMDD_HHMMSS"
}

$latestBak = $baks[0].FullName
Copy-Item -Force $latestBak $target
Write-Host "[OK] Restored latest backup:"
Write-Host "     $latestBak"
Write-Host "  -> $target"

# Make a fresh restore checkpoint backup
$restoreBak = "$target.restore.$(Timestamp)"
Copy-Item -Force $target $restoreBak
Write-Host "[OK] Restore checkpoint backup: $restoreBak"

# 2) Patch: replace any roleSource template literal containing ${roleSource}
# This avoids needing to match the mojibake characters themselves.
$txt = ReadText $target
$orig = $txt

# Replace patterns like:
# {roleSource ? `...${roleSource}...` : ""}
# with:
# {roleSource ? " - " + roleSource : ""}
$rx = [regex]::new('\{roleSource\s*\?\s*`[^`]*\$\{roleSource\}[^`]*`\s*:\s*""\s*\}', 'Singleline')
if(-not $rx.IsMatch($txt)){
  Fail "ANCHOR NOT FOUND: could not find roleSource template literal containing `${roleSource}` to rewrite."
}

$txt = $rx.Replace($txt, '{roleSource ? " - " + roleSource : ""}', 1)

# Guard: ensure we did not accidentally remove newlines
if($txt.Length -lt 200){
  Fail "Sanity check failed: patched file unexpectedly short."
}

if($txt -eq $orig){
  Fail "No changes made (unexpected)."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched roleSource display to ASCII-only: ' - '"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
