$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Die($m){ throw $m }

function Find-RepoRoot([string]$StartDir){
  $dir = Resolve-Path -LiteralPath $StartDir
  while($true){
    $pkg = Join-Path -Path $dir -ChildPath "package.json"
    if(Test-Path -LiteralPath $pkg){ return $dir.Path }
    $parent = Split-Path -Path $dir -Parent
    if(-not $parent -or $parent -eq $dir.Path){ break }
    $dir = $parent
  }
  throw "Could not find repo root (package.json) from: $StartDir"
}

Write-Host "== JRide Patch: Passenger Signup sends town_origin to /api/public/auth/signup (V1 / PS5-safe) =="

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Find-RepoRoot $scriptDir
Ok "RepoRoot: $repoRoot"

$targetRel = "app\passenger-signup\page.tsx"
$target = Join-Path -Path $repoRoot -ChildPath $targetRel
if(-not (Test-Path -LiteralPath $target)){ Die "Missing target: $targetRel" }
Ok "Target: $target"

# Backup
$bakDir = Join-Path $repoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("passenger-signup.page.tsx.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src
$changed = $false

# ----------------------------
# 1) Ensure React useState import exists (best-effort, PS5-safe)
# ----------------------------
if($src -match 'from\s+["'']react["'']' -and $src -notmatch '\buseState\b'){
  if($src -match '(?m)^\s*import\s+\{\s*([^}]*)\}\s+from\s+["'']react["'']\s*;\s*$'){
    $src2 = [regex]::Replace($src, '(?m)^\s*import\s+\{\s*([^}]*)\}\s+from\s+["'']react["'']\s*;\s*$',
      { param($m)
        $inside = $m.Groups[1].Value
        if($inside -match '\buseState\b'){ return $m.Value }
        return "import { " + $inside.Trim() + ", useState } from `"react`";"
      }, 1)
    if($src2 -ne $src){ $src = $src2; $changed = $true; Ok "Added useState to react import." }
  } elseif($src -match '(?m)^\s*import\s+React\s+from\s+["'']react["'']\s*;\s*$'){
    $src2 = [regex]::Replace($src, '(?m)^\s*import\s+React\s+from\s+["'']react["'']\s*;\s*$',
      'import React, { useState } from "react";', 1)
    if($src2 -ne $src){ $src = $src2; $changed = $true; Ok "Converted React import to include useState." }
  } else {
    Warn "Could not safely modify react import; if build fails, ensure useState is imported."
  }
}

# ----------------------------
# 2) Ensure townOrigin / barangayOrigin state exists (insert after first useState line)
# ----------------------------
$hasTownState = ($src -match '\bconst\s+\[\s*townOrigin\s*,\s*setTownOrigin\s*\]\s*=\s*useState\(')
$hasBrgyState = ($src -match '\bconst\s+\[\s*barangayOrigin\s*,\s*setBarangayOrigin\s*\]\s*=\s*useState\(')

if((-not $hasTownState) -or (-not $hasBrgyState)){
  $pat = '(?s)(const\s+\[[^\]]+\]\s*=\s*useState\([^\)]*\)\s*;\s*)'
  if($src -match $pat){
    $block = "`n  // JRIDE_TOWN_ORIGIN_STATE_V1`n"
    if(-not $hasTownState){
      $block += "  const [townOrigin, setTownOrigin] = useState(`"`");`n"
    }
    if(-not $hasBrgyState){
      $block += "  const [barangayOrigin, setBarangayOrigin] = useState(`"`");`n"
    }
    $block += "`n"
    $src2 = [regex]::Replace($src, $pat, { param($m) $m.Value + $block }, 1)
    if($src2 -ne $src){
      $src = $src2; $changed = $true
      Ok "Injected missing townOrigin/barangayOrigin state."
    }
  } else {
    Warn "Could not find a useState() anchor to inject townOrigin/barangayOrigin state. If build fails, we will patch by a different anchor."
  }
} else {
  Ok "State OK: townOrigin/barangayOrigin already present."
}

# ----------------------------
# 3) Inject town_origin + barangay_origin into the signup fetch JSON body
# ----------------------------
# If already present in JSON body, skip
if($src -match 'fetch\(\s*["'']/api/public/auth/signup["'']' -and $src -match '\btown_origin\b'){
  Ok "No changes needed: signup request already includes town_origin."
} else {
  # Find JSON.stringify({ ... }) inside the /api/public/auth/signup fetch call and inject.
  # We inject right after the opening { of JSON.stringify.
  $pat = '(?s)(fetch\(\s*["'']/api/public/auth/signup["'']\s*,\s*\{.*?body\s*:\s*JSON\.stringify\(\s*\{\s*)'
  if($src -match $pat){
    $inject = @"
town_origin: String(townOrigin || "").trim(),
        barangay_origin: String(barangayOrigin || "").trim(),
        // JRIDE_TOWN_ORIGIN_BODY_V1
        
"@
    $src2 = [regex]::Replace($src, $pat, { param($m) $m.Groups[1].Value + $inject }, 1)
    if($src2 -ne $src){
      $src = $src2; $changed = $true
      Ok "Injected town_origin/barangay_origin into /api/public/auth/signup JSON body."
    } else {
      Die "Patch failed: did not modify the signup fetch JSON body."
    }
  } else {
    Die "Could not locate JSON.stringify({ ... }) body inside fetch('/api/public/auth/signup'). Refusing to patch blindly."
  }
}

# Write file if changed
if($changed){
  Set-Content -LiteralPath $target -Value $src -Encoding UTF8
  Ok "Patched: $targetRel"
} else {
  Ok "No changes needed (already compliant / idempotent)."
}

Ok "DONE. Next: npm.cmd run build, then create 1 new passenger account and verify DB."
