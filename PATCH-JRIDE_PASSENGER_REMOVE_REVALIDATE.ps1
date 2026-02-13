# PATCH-JRIDE_PASSENGER_REMOVE_REVALIDATE.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\passenger\page.tsx"
if(!(Test-Path $target)){ Fail "Missing: $target" }

$bak = "$target.bak." + (Stamp)
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# Remove any revalidate export (line-level)
$before = $txt
$txt = ($txt -split "`r?`n" | Where-Object { $_ -notmatch '^\s*export\s+const\s+revalidate\s*=' }) -join "`r`n"

if($txt -ne $before){
  Write-Host "[OK] Removed export const revalidate" -ForegroundColor Green
} else {
  Write-Host "[OK] No revalidate export found (skipped)" -ForegroundColor DarkGray
}

# Ensure dynamic=force-dynamic exists (add right after "use client"; if missing)
if($txt -notmatch '(?m)^\s*export\s+const\s+dynamic\s*=\s*["'']force-dynamic["'']\s*;\s*$'){
  if($txt -notmatch '(?m)^\s*"use client";\s*$'){ Fail '"use client"; not found as standalone line' }

  $txt = $txt -replace '(?m)^\s*"use client";\s*$',
@"
"use client";

export const dynamic = "force-dynamic";
"@
  Write-Host "[OK] Inserted export const dynamic = force-dynamic" -ForegroundColor Green
}

# Write back UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))

Write-Host "[OK] Patched: $target (UTF-8 no BOM)" -ForegroundColor Green
