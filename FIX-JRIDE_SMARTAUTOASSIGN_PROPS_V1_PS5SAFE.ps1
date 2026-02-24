# FIX-JRIDE_SMARTAUTOASSIGN_PROPS_V1_PS5SAFE.ps1
# Purpose:
# - Fix TS error:
#     SmartAutoAssignSuggestions Props has no 'trips' (did you mean 'trip'?)
# - Detect actual prop keys of SmartAutoAssignSuggestions component
# - Patch LiveTripsClient.tsx <SmartAutoAssignSuggestions .../> to ONLY pass supported props
# - Run: npm.cmd run build
#
# Deterministic behavior:
# - If component accepts 'trips' => keep trips
# - Else if accepts 'trip' => pass FIRST visible trip as 'trip'
# - Keep 'drivers' only if supported
# - Keep 'onAfterAction' only if supported; ensure signature is () => void
#
# PS5-safe. No interactive prompts.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ProjRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

function Ensure-Dir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

function Get-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Read-TextUtf8NoBom([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $false)
  return $utf8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup-File([string]$src, [string]$bakDir, [string]$tag) {
  Ensure-Dir $bakDir
  $ts = Get-Timestamp
  $name = [System.IO.Path]::GetFileName($src)
  $dst = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $tag, $ts)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Ok ("[OK] Backup: {0}" -f $dst)
}

function Extract-PropKeys([string]$componentPath) {
  $txt = Read-TextUtf8NoBom $componentPath
  $keys = New-Object "System.Collections.Generic.HashSet[string]"

  # interface Props { ... }
  $m1 = [System.Text.RegularExpressions.Regex]::Match(
    $txt,
    'interface\s+Props\s*\{(?<body>[\s\S]*?)\}',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if ($m1.Success) {
    $body = $m1.Groups['body'].Value
    $propMatches = [System.Text.RegularExpressions.Regex]::Matches(
      $body,
      '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:',
      [System.Text.RegularExpressions.RegexOptions]::Multiline
    )
    foreach ($pm in $propMatches) { [void]$keys.Add($pm.Groups[1].Value) }
  }

  # type Props = { ... };
  $m2 = [System.Text.RegularExpressions.Regex]::Match(
    $txt,
    'type\s+Props\s*=\s*\{(?<body>[\s\S]*?)\}\s*;',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if ($m2.Success) {
    $body = $m2.Groups['body'].Value
    $propMatches = [System.Text.RegularExpressions.Regex]::Matches(
      $body,
      '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:',
      [System.Text.RegularExpressions.RegexOptions]::Multiline
    )
    foreach ($pm in $propMatches) { [void]$keys.Add($pm.Groups[1].Value) }
  }

  return $keys
}

function Find-SmartAutoAssignFile([string]$root) {
  $candidates = @(
    (Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"),
    (Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.ts"),
    (Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.jsx"),
    (Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.js")
  )
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }

  $hit = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^SmartAutoAssignSuggestions\.(tsx|ts|jsx|js)$' } |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

function Patch-SmartAutoAssignBlock([string]$clientPath, [string]$newJsx) {
  $txt = Read-TextUtf8NoBom $clientPath

  # Replace FIRST self-closing <SmartAutoAssignSuggestions ... />
  $pattern = '<SmartAutoAssignSuggestions\b[\s\S]*?\/>'
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $m = $rx.Match($txt)
  if (-not $m.Success) {
    Fail "[FAIL] Could not find <SmartAutoAssignSuggestions ... /> block in LiveTripsClient.tsx."
  }

  $txt2 = $rx.Replace($txt, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $newJsx }, 1)
  Write-TextUtf8NoBom $clientPath $txt2
  Ok ("[OK] Patched SmartAutoAssignSuggestions usage in: {0}" -f $clientPath)
}

# ---------------- Main ----------------

Info "== JRIDE Fix: SmartAutoAssignSuggestions props mismatch (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)

$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $clientPath)) {
  Fail ("[FAIL] LiveTripsClient.tsx not found: {0}" -f $clientPath)
}

$smartPath = Find-SmartAutoAssignFile $root
if (-not $smartPath) {
  Fail "[FAIL] SmartAutoAssignSuggestions.(ts|tsx|js|jsx) not found under repo root."
}
Info ("[INFO] SmartAutoAssignSuggestions file: {0}" -f $smartPath)

$bakDir = Join-Path $root "_patch_bak"
Backup-File $clientPath $bakDir "SMARTAUTOASSIGN_PROPS_FIX_V1" | Out-Null
Backup-File $smartPath $bakDir "SMARTAUTOASSIGN_PROPS_FIX_V1" | Out-Null

$keys = Extract-PropKeys $smartPath
Info ("[INFO] Detected SmartAutoAssignSuggestions prop keys ({0}):" -f $keys.Count)
foreach ($k in ($keys | Sort-Object)) { Write-Host (" - {0}" -f $k) }

# Build JSX without -f formatting (avoid braces issues)
$newLines = New-Object System.Collections.Generic.List[string]
$newLines.Add("<SmartAutoAssignSuggestions")

# trips vs trip
if ($keys.Contains("trips")) {
  $newLines.Add("  trips={visibleTrips as any}")
} elseif ($keys.Contains("trip")) {
  $newLines.Add("  trip={(visibleTrips?.[0]) as any}")
} else {
  Warn "[WARN] Neither 'trips' nor 'trip' exists in Props. Not passing trip data."
}

# drivers
if ($keys.Contains("drivers")) {
  $newLines.Add("  drivers={drivers as any}")
} else {
  Warn "[WARN] Props has no 'drivers'. Not passing drivers."
}

# onAfterAction signature must be () => void
if ($keys.Contains("onAfterAction")) {
  $newLines.Add('  onAfterAction={() => setLastAction("action completed")}')
} elseif ($keys.Contains("onAfter") ) {
  $newLines.Add('  onAfter={() => setLastAction("action completed")}')
} else {
  Warn "[WARN] Props has no onAfterAction/onAfter. Not passing callback."
}

$newLines.Add("/>")
$newJsx = ($newLines -join "`n")

Info "[INFO] New SmartAutoAssignSuggestions JSX will be:"
Write-Host $newJsx -ForegroundColor Gray

Patch-SmartAutoAssignBlock $clientPath $newJsx

Info "== Running build =="
Push-Location $root
try {
  & npm.cmd run build
  Ok "[OK] npm run build finished"
} finally {
  Pop-Location
}

Ok "== Done =="
Ok "Next: git commit + tag + push (commands below)"