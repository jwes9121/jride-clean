# PATCH-DISPATCH-UI-SAFE-V5-MOVE-AFTER-ROWSFOREXPORT.ps1
# Moves the existing UI block (marked by: // --- UI: Missing LGU workflow (safe) ---)
# to after the rowsForExport declaration block (multi-line safe).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function Backup($p){
  if(!(Test-Path $p)){ throw "Missing file: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak"
}
function ReadAll($p){ [IO.File]::ReadAllText($p,[Text.Encoding]::UTF8) }
function WriteAll($p,$s){ [IO.File]::WriteAllText($p,$s,[Text.Encoding]::UTF8) }
function Fail($m){ throw $m }

$path = "app\dispatch\page.tsx"
Backup $path

$txt = ReadAll $path
$orig = $txt

# 1) Find and remove the UI block
$rxBlock = '(?s)\r?\n\s*// --- UI: Missing LGU workflow \(safe\) ---\s*.*?\r?\n\s*function\s+jumpToNextMissing\(\)\s*\{.*?\r?\n\s*\}\s*\r?\n'
$m = [regex]::Match($txt, $rxBlock)
if(-not $m.Success){
  Fail "Could not find the UI block marker to move."
}
$uiBlock = $m.Value
$txt = $txt.Remove($m.Index, $m.Length)
Write-Host "[OK] Removed UI block from current location."

# 2) Locate rowsForExport declaration (start)
$rxRowsStart = [regex]'(?m)^\s*const\s+rowsForExport\b'
$m1 = $rxRowsStart.Match($txt)
if(-not $m1.Success){
  Fail "Could not find 'const rowsForExport' in file."
}

# 3) Find the next "const <name>" AFTER rowsForExport line (insert before it)
$rxNextConst = New-Object System.Text.RegularExpressions.Regex('(?m)^\s*const\s+\w+', [System.Text.RegularExpressions.RegexOptions]::Multiline)
$m2 = $rxNextConst.Match($txt, $m1.Index + $m1.Length)

# if the next match is still the rowsForExport line, advance
if($m2.Success -and $m2.Index -eq $m1.Index){
  $m2 = $rxNextConst.Match($txt, $m1.Index + $m1.Length + 5)
}

$insertPos = if($m2.Success){ $m2.Index } else { $txt.Length }

$txt = $txt.Substring(0,$insertPos) + $uiBlock + $txt.Substring($insertPos)
Write-Host "[OK] Inserted UI block after rowsForExport block."

if($txt -eq $orig){ Fail "No changes produced (unexpected)." }

WriteAll $path $txt
Write-Host "[DONE] UI block moved. Next: npm.cmd run build"
