# PATCH-JRIDE_PUBLIC_BOOK_BYPASS_NIGHT_GATE_NO_REQ_V1_1.ps1
# PS5-safe: night gate bypass that does NOT require req in scope (uses headers() from next/headers).

$ErrorActionPreference = 'Stop'

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$repo   = (Get-Location).Path
$target = Join-Path $repo 'app\api\public\passenger\book\route.ts'

if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target"; exit 1 }

$src = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($src)) { Fail "[FAIL] Empty file: $target"; exit 1 }

# Backup
$bakDir = Join-Path $repo '_patch_bak'
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts  = Get-Date -Format 'yyyyMMdd_HHmmss'
$bak = Join-Path $bakDir ("route.ts.bak.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# 1) Ensure import { headers } from "next/headers";
$hasHeadersImport = [regex]::IsMatch(
  $src,
  'import\s*\{\s*headers\s*\}\s*from\s*["'']next/headers["'']\s*;?',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if (-not $hasHeadersImport) {
  $lines = $src -split "`r?`n"
  $lastImport = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*import\s+') { $lastImport = $i }
  }

  if ($lastImport -ge 0) {
    $list = New-Object System.Collections.Generic.List[string]
    for ($i=0; $i -lt $lines.Count; $i++) {
      $list.Add($lines[$i])
      if ($i -eq $lastImport) {
        $list.Add('import { headers } from "next/headers";')
      }
    }
    $src = ($list.ToArray() -join "`r`n")
    Ok '[OK] Added import: headers() from next/headers'
  } else {
    $src = 'import { headers } from "next/headers";' + "`r`n" + $src
    Ok '[OK] Added import at top: headers() from next/headers'
  }
} else {
  Warn '[WARN] headers() import already present'
}

# 2) Ensure helper exists in NO-ARG form (replace if old helper exists)
$helperBlock = @"
function jrideNightGateBypass(): boolean {
  try {
    const h = headers();
    const isTest = (h.get("x-jride-test") || "").trim() === "1";
    const bypass = (h.get("x-jride-bypass-night-gate") || "").trim() === "1";
    return isTest && bypass;
  } catch {
    return false;
  }
}

"@

$helperRegex = [regex]::new(
  'function\s+jrideNightGateBypass\s*\([^)]*\)\s*:\s*boolean\s*\{[\s\S]*?\n\}\s*\n',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if ($helperRegex.IsMatch($src)) {
  $src2 = $helperRegex.Replace($src, $helperBlock, 1)
  if ($src2 -ne $src) {
    $src = $src2
    Ok '[OK] Replaced existing jrideNightGateBypass() helper with headers()-based no-arg version'
  } else {
    Warn '[WARN] Helper found but replacement produced no change (unexpected). Appending helper.'
    $src = $src + "`r`n" + $helperBlock
    Ok '[OK] Appended no-arg jrideNightGateBypass() helper'
  }
} else {
  # Insert after imports (best effort)
  $lines = $src -split "`r?`n"
  $lastImport = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*import\s+') { $lastImport = $i }
  }

  $ins = 0
  if ($lastImport -ge 0) {
    $ins = $lastImport + 1
    while ($ins -lt $lines.Count -and $lines[$ins].Trim() -ne '') { $ins++ }
    $ins++
  }

  $list = New-Object System.Collections.Generic.List[string]
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($i -eq $ins) {
      $list.Add('')
      foreach ($hl in ($helperBlock -split "`r?`n")) { $list.Add($hl) }
    }
    $list.Add($lines[$i])
  }
  $src = ($list.ToArray() -join "`r`n")
  Ok '[OK] Injected no-arg jrideNightGateBypass() helper'
}

# 3) Normalize the Night Gate IF to use no-arg bypass
$patternIf = '^\s*if\s*\(\s*nightGate\s*&&\s*!verified(?:\s*&&\s*!jrideNightGateBypass\s*\(\s*[^)]*\s*\))?\s*\)\s*\{'
$replacementIf = 'if (nightGate && !verified && !jrideNightGateBypass()) {'

if (-not [regex]::IsMatch($src, $patternIf, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
  Fail '[FAIL] Could not find night gate IF (if (nightGate && !verified) {) to patch.'
  exit 1
}

$srcNew = [regex]::Replace(
  $src,
  $patternIf,
  $replacementIf,
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

if ($srcNew -eq $src) {
  Warn '[WARN] Night gate IF appears already normalized. No change made.'
} else {
  $src = $srcNew
  Ok '[OK] Patched Night Gate IF to use no-arg header bypass'
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Ok ("[OK] Wrote: {0}" -f $target)
Ok '[OK] Done.'
