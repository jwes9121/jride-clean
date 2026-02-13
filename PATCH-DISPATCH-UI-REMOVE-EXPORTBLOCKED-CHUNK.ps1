# PATCH-DISPATCH-UI-REMOVE-EXPORTBLOCKED-CHUNK.ps1
# Removes Operator Bar references to exportBlocked/incompleteCount (not present in restored file)
# Replaces the export status JSX block with a safe Missing-LGU status.
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

# Find the operator bar block portion that starts at:
# <div className="text-sm"> {typeof exportBlocked ...
# and ends just before the first <button ... setShowMissingOnly
$pattern = '(?s)<div className="text-sm">\s*\{typeof exportBlocked[\s\S]*?\}\s*</div>\s*'
if(-not [regex]::IsMatch($txt, $pattern)){
  Fail "Could not find exportBlocked status chunk in Operator Bar."
}

$replacement = @'
<div className="text-sm">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-800">
                Missing LGU: {missingCountUi}
              </span>
            </div>
'@

$txt = [regex]::Replace($txt, $pattern, $replacement, 1)

if($txt -eq $orig){ Fail "No changes produced (unexpected)." }

WriteAll $path $txt
Write-Host "[DONE] Removed exportBlocked status chunk; replaced with Missing LGU status."
Write-Host "Next: npm.cmd run build"
