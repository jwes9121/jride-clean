# PATCH-JRIDE_PUBLIC_BOOK_BYPASS_NIGHT_GATE_TEST_V3_1.ps1
# PS5-safe: bypass NIGHT_GATE_UNVERIFIED only when headers are present.
# Edits only the night gate IF condition.

$ErrorActionPreference = 'Stop'

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$repo   = (Get-Location).Path
$target = Join-Path $repo 'app\api\public\passenger\book\route.ts'

if (!(Test-Path -LiteralPath $target)) {
  Fail ("[FAIL] Target not found: {0}" -f $target)
  exit 1
}

$src = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($src)) {
  Fail ("[FAIL] Empty file: {0}" -f $target)
  exit 1
}

# Backup
$bakDir = Join-Path $repo '_patch_bak'
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts  = Get-Date -Format 'yyyyMMdd_HHmmss'
$bak = Join-Path $bakDir ("route.ts.bak.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# Detect POST param name (req variable)
$reqName = $null
$m = [regex]::Match($src, 'export\s+async\s+function\s+POST\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Request', 'IgnoreCase')
if ($m.Success) {
  $reqName = $m.Groups[1].Value
} else {
  $m2 = [regex]::Match($src, 'export\s+async\s+function\s+POST\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)\s]', 'IgnoreCase')
  if ($m2.Success) { $reqName = $m2.Groups[1].Value }
}

if ([string]::IsNullOrWhiteSpace($reqName)) {
  Fail '[FAIL] Could not detect POST(req) parameter name.'
  exit 1
}
Ok ("[OK] Detected POST param: {0}" -f $reqName)

# Ensure helper exists (idempotent)
if ($src -notmatch 'function\s+jrideNightGateBypass\s*\(') {

$helperBlock = @"
function jrideNightGateBypass(req: Request): boolean {
  try {
    const h = req?.headers;
    const isTest = (h?.get("x-jride-test") || "").trim() === "1";
    const bypass = (h?.get("x-jride-bypass-night-gate") || "").trim() === "1";
    return isTest && bypass;
  } catch {
    return false;
  }
}

"@

  $lines = $src -split "`r?`n"
  $lastImport = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*import\s+') { $lastImport = $i }
  }

  if ($lastImport -ge 0) {
    $j = $lastImport + 1
    while ($j -lt $lines.Count -and $lines[$j].Trim() -ne '') { $j++ }

    $newLines = New-Object System.Collections.Generic.List[string]
    for ($k=0; $k -lt $lines.Count; $k++) {
      $newLines.Add($lines[$k])
      if ($k -eq $j) {
        $newLines.Add('')
        foreach ($hl in ($helperBlock -split "`r?`n")) { $newLines.Add($hl) }
      }
    }
    $src = ($newLines.ToArray() -join "`r`n")
    Ok '[OK] Injected helper jrideNightGateBypass()'
  } else {
    $src = $helperBlock + $src
    Ok '[OK] Injected helper jrideNightGateBypass() at top'
  }

} else {
  Warn '[WARN] Helper already present: jrideNightGateBypass()'
}

# If already patched, stop cleanly
$already = [regex]::IsMatch(
  $src,
  '^\s*if\s*\(\s*nightGate\s*&&\s*!verified\s*&&\s*!jrideNightGateBypass\s*\(',
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

if ($already) {
  Warn '[WARN] Night gate condition already patched. No changes made.'
} else {

  $pattern = '^\s*if\s*\(\s*nightGate\s*&&\s*!verified\s*\)\s*\{'
  $replacement = ('if (nightGate && !verified && !jrideNightGateBypass({0})) {{' -f $reqName)

  if (-not [regex]::IsMatch($src, $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    Fail '[FAIL] Could not find the night gate condition: if (nightGate && !verified) {'
    exit 1
  }

  $src2 = [regex]::Replace(
    $src,
    $pattern,
    $replacement,
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )

  if ($src2 -eq $src) {
    Fail '[FAIL] Replace produced no change (unexpected).'
    exit 1
  }

  $src = $src2
  Ok '[OK] Patched night gate IF condition to include header bypass'
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Ok ("[OK] Wrote: {0}" -f $target)
Ok '[OK] Done.'
