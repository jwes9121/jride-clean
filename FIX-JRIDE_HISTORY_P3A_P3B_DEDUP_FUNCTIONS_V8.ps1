# FIX-JRIDE_HISTORY_P3A_P3B_DEDUP_FUNCTIONS_V8.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\history\page.tsx"
if (!(Test-Path $target)) { Fail ("Missing file: " + $target) }

$txt = Get-Content -Raw -LiteralPath $target

# ---- backup ----
$bak = ($target + ".bak." + (Stamp))
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

function Remove-DuplicateFunctionImplementations {
  param(
    [string]$Content,
    [string]$FunctionName
  )

  $needle = "function " + $FunctionName + "("

  # Find ALL occurrences
  $idxs = New-Object System.Collections.Generic.List[int]
  $start = 0
  while ($true) {
    $i = $Content.IndexOf($needle, $start, [StringComparison]::Ordinal)
    if ($i -lt 0) { break }
    $idxs.Add($i) | Out-Null
    $start = $i + 1
  }

  if ($idxs.Count -le 1) {
    return @{ content = $Content; removed = 0 }
  }

  # Keep first occurrence, remove all later duplicates
  $removed = 0
  for ($k = $idxs.Count - 1; $k -ge 1; $k--) {
    $fnStart = $idxs[$k]

    # Find first "{" after function signature
    $braceOpen = $Content.IndexOf("{", $fnStart, [StringComparison]::Ordinal)
    if ($braceOpen -lt 0) { Fail ("Could not find '{' for function " + $FunctionName) }

    # Walk forward and match braces to find the function end
    $depth = 0
    $pos = $braceOpen
    $len = $Content.Length

    while ($pos -lt $len) {
      $ch = $Content[$pos]
      if ($ch -eq "{") { $depth++ }
      elseif ($ch -eq "}") {
        $depth--
        if ($depth -eq 0) {
          $fnEnd = $pos + 1

          # Also remove trailing whitespace/newlines after function for clean formatting
          while ($fnEnd -lt $len) {
            $c2 = $Content[$fnEnd]
            if ($c2 -eq "`r" -or $c2 -eq "`n" -or $c2 -eq " " -or $c2 -eq "`t") { $fnEnd++ }
            else { break }
          }

          $Content = $Content.Substring(0, $fnStart) + $Content.Substring($fnEnd)
          $removed++
          break
        }
      }
      $pos++
    }

    if ($depth -ne 0) { Fail ("Unbalanced braces while removing duplicate for " + $FunctionName) }
  }

  return @{ content = $Content; removed = $removed }
}

$names = @(
  "addFavorite",
  "removeFavorite",
  "rideAgain",
  "loadFavorites",
  "saveFavorites"
)

$totalRemoved = 0
foreach ($n in $names) {
  $res = Remove-DuplicateFunctionImplementations -Content $txt -FunctionName $n
  $txt = $res.content
  if ($res.removed -gt 0) {
    Write-Host ("[OK] Removed duplicates: " + $n + " x" + $res.removed) -ForegroundColor Green
    $totalRemoved += [int]$res.removed
  }
}

if ($totalRemoved -eq 0) {
  Write-Host "[WARN] No duplicate target functions found. (If build still errors, tell me the exact duplicate function name.)" -ForegroundColor Yellow
}

# ---- write UTF-8 no BOM ----
[System.IO.File]::WriteAllText($target, $txt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("[OK] Wrote: " + $target) -ForegroundColor Green
