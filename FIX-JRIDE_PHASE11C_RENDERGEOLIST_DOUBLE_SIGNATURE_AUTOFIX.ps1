# FIX-JRIDE_PHASE11C_RENDERGEOLIST_DOUBLE_SIGNATURE_AUTOFIX.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel  = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

if ($txt.IndexOf("function renderGeoList") -lt 0) {
  Fail "Anchor not found: function renderGeoList"
}

# Match ANY duplicated signature form:
# function renderGeoList(<sig>) { (<anything>) {
# - Works across spaces/newlines
# - Keeps <sig> exactly as-is
$pattern = '(?s)function\s+renderGeoList\s*\(\s*(?<sig>[^)]*?)\s*\)\s*\{\s*\(\s*.*?\)\s*\{'

$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
$matches = $rx.Matches($txt)
$cnt = $matches.Count

if ($cnt -gt 0) {
  $txt = $rx.Replace($txt, {
    param($m)
    $sig = $m.Groups["sig"].Value
    return "function renderGeoList(" + $sig + ") {"
  }, 0)

  Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
  Write-Host "[DONE] Fixed duplicated renderGeoList signature occurrences: $cnt"
  exit 0
}

Write-Host "[WARN] No duplicated renderGeoList signature match found by generic regex."
Write-Host "Showing a snippet around the first occurrence for diagnosis (no manual edits):"

$pos = $txt.IndexOf("function renderGeoList")
if ($pos -lt 0) { Fail "Unexpected: renderGeoList not found after earlier check." }

$start = [Math]::Max(0, $pos - 200)
$len = [Math]::Min($txt.Length - $start, 600)
$snip = $txt.Substring($start, $len)

Write-Host "----- SNIP START -----"
Write-Host $snip
Write-Host "----- SNIP END -----"

Fail "Autofix did not find the duplicated pattern. The snippet above shows the exact corruption near renderGeoList."
