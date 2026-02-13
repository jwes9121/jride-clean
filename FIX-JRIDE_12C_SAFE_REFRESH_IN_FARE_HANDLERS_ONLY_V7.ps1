# FIX-JRIDE_12C_SAFE_REFRESH_IN_FARE_HANDLERS_ONLY_V7.ps1
# ASCII-only | UTF8 NO BOM
# Restores latest backup, then replaces refresh() ONLY inside fareAccept/fareReject blocks.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

# Restore latest backup (from the failed V6 attempt)
$baks = Get-ChildItem -LiteralPath (Split-Path -Parent $target) -Filter "page.tsx.bak.*" -File | Sort-Object LastWriteTime -Descending
if(!$baks -or $baks.Count -eq 0){ Fail "No backups found next to $target" }
$latestBak = $baks[0].FullName
Copy-Item -Force $latestBak $target
Write-Host "[OK] Restored: $latestBak"
Write-Host "  -> $target"

# checkpoint
$chk = "$target.restore.$(TS)"
Copy-Item -Force $target $chk
Write-Host "[OK] Restore checkpoint: $chk"

$txt = ReadT $target
$orig = $txt

$safe = @'
  try {
    if (typeof (refetch as any) === "function") (refetch as any)();
    else if (typeof (reload as any) === "function") (reload as any)();
    else if (typeof (load as any) === "function") (load as any)();
    else if (typeof (loadLive as any) === "function") (loadLive as any)();
    else if (typeof (fetchLive as any) === "function") (fetchLive as any)();
    else if (typeof (getLive as any) === "function") (getLive as any)();
  } catch {}
'@

function PatchBlock($name){
  param([string]$n)
}

# Patch fareAccept block
$rxA = [regex]::new('(async function\s+fareAccept\s*\(\)\s*\{[\s\S]*?\n)\s*refresh\(\);\s*([\s\S]*?\n\s*\}\s*\n)', 'Singleline')
if($rxA.IsMatch($txt)){
  $txt = $rxA.Replace($txt, "`$1$safe`r`n`$2", 1)
  Write-Host "[OK] Patched refresh() inside fareAccept()"
} else {
  Write-Host "[WARN] No refresh() found inside fareAccept() (ok)."
}

# Patch fareReject block
$rxR = [regex]::new('(async function\s+fareReject\s*\(\)\s*\{[\s\S]*?\n)\s*refresh\(\);\s*([\s\S]*?\n\s*\}\s*\n)', 'Singleline')
if($rxR.IsMatch($txt)){
  $txt = $rxR.Replace($txt, "`$1$safe`r`n`$2", 1)
  Write-Host "[OK] Patched refresh() inside fareReject()"
} else {
  Write-Host "[WARN] No refresh() found inside fareReject() (ok)."
}

if($txt -eq $orig){
  Fail "No changes applied."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Updated $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
