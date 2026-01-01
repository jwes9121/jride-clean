# FIX-JRIDE_PHASE11A_DEDUPE_GETJSON_HARD.ps1
# Hard dedupe: ensures ONLY ONE "async function getJson(url: string) { ... }" remains in app\ride\page.tsx
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = Join-Path (Get-Location) "app\ride\page.tsx"
if (-not (Test-Path $path)) { Fail "Not found: $path" }
Info "Target: $path"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw -Encoding UTF8
$needle = "async function getJson(url: string)"

function FindAll($s, $sub) {
  $idxs = @()
  $startAt = 0
  while ($true) {
    $i = $s.IndexOf($sub, $startAt)
    if ($i -lt 0) { break }
    $idxs += $i
    $startAt = $i + 1
  }
  return $idxs
}

function RemoveFunctionAt($s, $startIdx) {
  # find opening brace
  $braceOpen = $s.IndexOf("{", $startIdx)
  if ($braceOpen -lt 0) { Fail "Could not find opening brace for getJson() at index $startIdx" }

  # brace match
  $depth = 0
  $pos = $braceOpen
  $len = $s.Length
  $end = -1
  while ($pos -lt $len) {
    $ch = $s.Substring($pos, 1)
    if ($ch -eq "{") { $depth++ }
    elseif ($ch -eq "}") {
      $depth--
      if ($depth -eq 0) { $end = $pos; break }
    }
    $pos++
  }
  if ($end -lt 0) { Fail "Could not find closing brace for getJson() at index $startIdx" }

  # include trailing whitespace/newlines
  $cutEnd = $end + 1
  while ($cutEnd -lt $len) {
    $c = $s.Substring($cutEnd, 1)
    if ($c -eq "`r" -or $c -eq "`n" -or $c -eq " " -or $c -eq "`t") { $cutEnd++ } else { break }
  }

  $before = $s.Substring(0, $startIdx)
  $after  = $s.Substring($cutEnd)
  return ($before + $after)
}

$idxs = FindAll $txt $needle
if ($idxs.Count -le 1) {
  Fail "No duplicate getJson() found. Count: $($idxs.Count). If build still says duplicate, paste the OTHER getJson block text."
}

# Keep the first occurrence, remove all later ones from the end backwards (stable indices).
for ($k = $idxs.Count - 1; $k -ge 1; $k--) {
  $txt = RemoveFunctionAt $txt $idxs[$k]
}

# Verify
$idxs2 = FindAll $txt $needle
if ($idxs2.Count -ne 1) {
  Fail "Dedupe failed. Remaining getJson count: $($idxs2.Count)"
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Removed duplicate getJson() implementations. Remaining count: 1"
Ok "Done."
