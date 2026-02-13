# FIX-JRIDE_WALLET_ADJUST_RESTORE_BALANCED_BACKUP_AND_DETEMPLATE_V2.ps1
# Purpose:
# 1) Your current page.tsx is broken ("Unexpected eof").
# 2) We restore the newest backup that is structurally balanced (braces/parens/brackets + quotes/backticks + comments).
# 3) Then we remove the risky template-literal fetch URLs with ${encodeURIComponent(...)} by rewriting fetch first-arg to concatenation.
#
# This script does NOT require TypeScript. Only PowerShell + Node not needed.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Backup-File($path) {
  if (!(Test-Path $path)) { Fail "File not found: $path" }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$stamp"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-Text($path) {
  return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Write-Text($path, $txt) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $txt, $utf8NoBom)
}

function Find-PrevIndex($s, $needle, $fromIdx) {
  return $s.LastIndexOf($needle, $fromIdx, [System.StringComparison]::Ordinal)
}

function Find-FetchFirstArgSpan-ByHint($s, $hintNeedle) {
  $hint = $s.IndexOf($hintNeedle, [System.StringComparison]::Ordinal)
  if ($hint -lt 0) { return $null }

  $fetchIdx = Find-PrevIndex $s "fetch(" $hint
  if ($fetchIdx -lt 0) { Fail "Could not find 'fetch(' before hint: $hintNeedle" }

  $i = $fetchIdx + "fetch(".Length
  while ($i -lt $s.Length -and [char]::IsWhiteSpace($s[$i])) { $i++ }
  $argStart = $i

  $parenDepth = 1
  $braceDepth = 0
  $brackDepth = 0
  $inStr = $false
  $strQuote = [char]0
  $escape = $false

  for ($j = $argStart; $j -lt $s.Length; $j++) {
    $ch = $s[$j]

    if ($escape) { $escape = $false; continue }

    if ($inStr) {
      if ($ch -eq '\') { $escape = $true; continue }
      if ($ch -eq $strQuote) { $inStr = $false; $strQuote = [char]0; continue }
      continue
    } else {
      if ($ch -eq '"' -or $ch -eq "'" -or $ch -eq '`') { $inStr = $true; $strQuote = $ch; continue }

      switch ($ch) {
        '(' { $parenDepth++; continue }
        ')' { $parenDepth--; if ($parenDepth -le 0) { Fail "Unexpected ')' before first arg ended for hint: $hintNeedle" }; continue }
        '{' { $braceDepth++; continue }
        '}' { if ($braceDepth -gt 0) { $braceDepth-- }; continue }
        '[' { $brackDepth++; continue }
        ']' { if ($brackDepth -gt 0) { $brackDepth-- }; continue }
        ',' {
          if ($parenDepth -eq 1 -and $braceDepth -eq 0 -and $brackDepth -eq 0) {
            return @{ ArgStart = $argStart; ArgEndExclusive = $j }
          }
          continue
        }
        default { continue }
      }
    }
  }

  Fail "Could not find end of first fetch() argument for hint: $hintNeedle"
}

function Patch-FetchFirstArg($txt, $hint, $newExpr) {
  $span = Find-FetchFirstArgSpan-ByHint $txt $hint
  if ($null -eq $span) { return $txt }

  $a = $span.ArgStart
  $b = $span.ArgEndExclusive
  $old = $txt.Substring($a, $b - $a).Trim()

  if ($old -eq $newExpr) { return $txt }
  Write-Host "[OK] De-templated fetch URL for hint: $hint"
  return $txt.Substring(0, $a) + $newExpr + $txt.Substring($b)
}

function Is-Balanced-TSX($txt) {
  $paren = 0
  $brace = 0
  $brack = 0

  $inSQ = $false
  $inDQ = $false
  $inBT = $false
  $inLine = $false
  $inBlock = $false
  $escape = $false

  for ($i = 0; $i -lt $txt.Length; $i++) {
    $ch = $txt[$i]
    $next = if ($i + 1 -lt $txt.Length) { $txt[$i + 1] } else { [char]0 }

    if ($inLine) {
      if ($ch -eq "`n") { $inLine = $false }
      continue
    }

    if ($inBlock) {
      if ($ch -eq '*' -and $next -eq '/') { $inBlock = $false; $i++; continue }
      continue
    }

    if ($escape) { $escape = $false; continue }

    if ($inSQ) {
      if ($ch -eq '\') { $escape = $true; continue }
      if ($ch -eq "'") { $inSQ = $false; continue }
      continue
    }

    if ($inDQ) {
      if ($ch -eq '\') { $escape = $true; continue }
      if ($ch -eq '"') { $inDQ = $false; continue }
      continue
    }

    if ($inBT) {
      if ($ch -eq '\') { $escape = $true; continue }
      if ($ch -eq '`') { $inBT = $false; continue }
      continue
    }

    # not in string/comment
    if ($ch -eq '/' -and $next -eq '/') { $inLine = $true; $i++; continue }
    if ($ch -eq '/' -and $next -eq '*') { $inBlock = $true; $i++; continue }

    if ($ch -eq "'") { $inSQ = $true; continue }
    if ($ch -eq '"') { $inDQ = $true; continue }
    if ($ch -eq '`') { $inBT = $true; continue }

    switch ($ch) {
      '(' { $paren++; continue }
      ')' { $paren--; if ($paren -lt 0) { return $false }; continue }
      '{' { $brace++; continue }
      '}' { $brace--; if ($brace -lt 0) { return $false }; continue }
      '[' { $brack++; continue }
      ']' { $brack--; if ($brack -lt 0) { return $false }; continue }
      default { continue }
    }
  }

  if ($inSQ -or $inDQ -or $inBT -or $inBlock) { return $false }
  if ($paren -ne 0 -or $brace -ne 0 -or $brack -ne 0) { return $false }
  return $true
}

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\wallet-adjust\page.tsx"
$dir = Split-Path $target -Parent

Write-Host "[INFO] Target: $target"
Backup-File $target

$backs = Get-ChildItem -LiteralPath $dir -Filter "page.tsx.bak.*" -File | Sort-Object Name -Descending
if (!$backs -or $backs.Count -eq 0) { Fail "No backups found (page.tsx.bak.*) in $dir" }

Write-Host "[INFO] Scanning backups for newest structurally-balanced restore point..."
$restore = $null
foreach ($b in $backs) {
  $t = Read-Text $b.FullName
  if (Is-Balanced-TSX $t) { $restore = $b; break }
}

if ($null -eq $restore) {
  Fail "No structurally-balanced backup found. (All backups appear unbalanced: missing brace/backtick/comment.)"
}

Write-Host "[OK] Restoring from: $($restore.Name)"
Copy-Item -LiteralPath $restore.FullName -Destination $target -Force

# De-template known problematic fetch URLs
$txt = Read-Text $target
$txt = Patch-FetchFirstArg $txt "/api/admin/wallet/driver-summary?driver_id=" '"/api/admin/wallet/driver-summary?driver_id=" + encodeURIComponent(driver_id)'
$txt = Patch-FetchFirstArg $txt "/api/admin/wallet/vendor-summary?vendor_id=" '"/api/admin/wallet/vendor-summary?vendor_id=" + encodeURIComponent(vendor_id)'
$txt = Patch-FetchFirstArg $txt "/api/admin/wallet/driver-summary?q=" '"/api/admin/wallet/driver-summary?q=" + encodeURIComponent(qq)'

Write-Text $target $txt
Write-Host "[OK] Restored + de-templated fetch URLs: $target"

Write-Host ""
Write-Host "==================== NEXT: BUILD/TEST ===================="
Write-Host "npm.cmd run build"
Write-Host "npm.cmd run dev"
Write-Host "==========================================================="
Write-Host ""

Write-Host "==================== POST-SCRIPT (RUN THESE) ===================="
Write-Host "npm.cmd run build"
Write-Host "git status"
Write-Host "git add -A"
Write-Host "git commit -m `"JRIDE: restore wallet-adjust from balanced backup + remove fetch template literals`""
Write-Host "git tag JRIDE_WALLET_ADJUST_RESTORE_BALANCED_DETEMPLATE_V2"
Write-Host "git push"
Write-Host "git push --tags"
Write-Host "=================================================================="
