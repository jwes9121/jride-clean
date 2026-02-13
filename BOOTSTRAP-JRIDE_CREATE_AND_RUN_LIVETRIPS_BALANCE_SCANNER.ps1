# BOOTSTRAP-JRIDE_CREATE_AND_RUN_LIVETRIPS_BALANCE_SCANNER.ps1
# Creates the missing DIAG scanner file, runs it, then runs npm build.
# HARD RULE: DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$diagName = "DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
$diagPath = Join-Path $root $diagName

# Write the scanner file (overwrite to ensure correct content)
$scanner = @'
# DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1
# Diagnostic: scans LiveTripsClient.tsx and finds the first mismatch/unclosed brace/paren/bracket.
# Outputs exact line/column + context.
# HARD RULES: DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$file = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $file)){ Fail ("File not found: " + $file) }

$txt = Get-Content -LiteralPath $file -Raw -Encoding UTF8

# Build line index map (start offsets of each line)
$lineStarts = New-Object System.Collections.Generic.List[int]
$lineStarts.Add(0) | Out-Null
for($i=0; $i -lt $txt.Length; $i++){
  if($txt[$i] -eq "`n"){
    $lineStarts.Add($i+1) | Out-Null
  }
}

function Get-LineCol([int]$pos){
  $line = 0
  $lo = 0; $hi = $lineStarts.Count - 1
  while($lo -le $hi){
    $mid = [int](($lo + $hi) / 2)
    if($lineStarts[$mid] -le $pos){
      $line = $mid
      $lo = $mid + 1
    } else {
      $hi = $mid - 1
    }
  }
  $col0 = $pos - $lineStarts[$line]
  return @{ line = $line + 1; col = $col0 + 1; line0 = $line; col0 = $col0 }
}

function Get-LineText([int]$line1){
  $idx = $line1 - 1
  if($idx -lt 0 -or $idx -ge $lineStarts.Count){ return "" }
  $start = $lineStarts[$idx]
  $end = $txt.IndexOf("`n", $start)
  if($end -lt 0){ $end = $txt.Length }
  $s = $txt.Substring($start, $end - $start)
  return $s.TrimEnd("`r")
}

$stack = New-Object System.Collections.Generic.List[object]

$inLineComment = $false
$inBlockComment = $false
$inSQ = $false
$inDQ = $false
$inBT = $false
$escape = $false

function Push([char]$c, [int]$pos){
  $stack.Add(@{ ch = $c; pos = $pos }) | Out-Null
}
function PopExpect([char]$close, [int]$pos){
  $expect = $null
  if($close -eq ')'){ $expect = '(' }
  elseif($close -eq ']'){ $expect = '[' }
  elseif($close -eq '}'){ $expect = '{' }
  else { return $true }

  if($stack.Count -lt 1){
    $lc = Get-LineCol $pos
    Write-Host ""
    Write-Host "[MISMATCH] Closing '$close' with EMPTY stack at line $($lc.line), col $($lc.col)"
    return $false
  }
  $top = $stack[$stack.Count - 1]
  if([char]$top.ch -ne $expect){
    $lc = Get-LineCol $pos
    $op = Get-LineCol $top.pos
    Write-Host ""
    Write-Host "[MISMATCH] Closing '$close' at line $($lc.line), col $($lc.col) but top of stack is '$([char]$top.ch)' opened at line $($op.line), col $($op.col)"
    return $false
  }
  $stack.RemoveAt($stack.Count - 1)
  return $true
}

for($i=0; $i -lt $txt.Length; $i++){
  $c = $txt[$i]

  if($c -eq "`n"){
    $inLineComment = $false
    $escape = $false
    continue
  }

  if($inLineComment){ continue }

  if($inBlockComment){
    if($c -eq '*' -and ($i+1) -lt $txt.Length -and $txt[$i+1] -eq '/'){
      $inBlockComment = $false
      $i++ | Out-Null
    }
    continue
  }

  if($inSQ){
    if($escape){ $escape = $false; continue }
    if($c -eq '\'){ $escape = $true; continue }
    if($c -eq "'"){ $inSQ = $false; continue }
    continue
  }
  if($inDQ){
    if($escape){ $escape = $false; continue }
    if($c -eq '\'){ $escape = $true; continue }
    if($c -eq '"'){ $inDQ = $false; continue }
    continue
  }
  if($inBT){
    if($escape){ $escape = $false; continue }
    if($c -eq '\'){ $escape = $true; continue }
    if($c -eq '`'){ $inBT = $false; continue }
    continue
  }

  if($c -eq '/' -and ($i+1) -lt $txt.Length){
    $n = $txt[$i+1]
    if($n -eq '/'){
      $inLineComment = $true
      $i++ | Out-Null
      continue
    }
    if($n -eq '*'){
      $inBlockComment = $true
      $i++ | Out-Null
      continue
    }
  }

  if($c -eq "'"){ $inSQ = $true; continue }
  if($c -eq '"'){ $inDQ = $true; continue }
  if($c -eq '`'){ $inBT = $true; continue }

  if($c -eq '(' -or $c -eq '[' -or $c -eq '{'){
    Push $c $i
    continue
  }
  if($c -eq ')' -or $c -eq ']' -or $c -eq '}'){
    if(-not (PopExpect $c $i)){
      $lc = Get-LineCol $i
      $startLine = [Math]::Max(1, $lc.line - 4)
      $endLine = [Math]::Min($lineStarts.Count, $lc.line + 4)
      Write-Host ""
      Write-Host "Context:"
      for($L=$startLine; $L -le $endLine; $L++){
        $lineText = Get-LineText $L
        if($L -eq $lc.line){
          Write-Host ("--> {0,4}: {1}" -f $L, $lineText)
          Write-Host ("         {0}" -f (" " * ([Math]::Max(0, $lc.col - 1)) + "^"))
        } else {
          Write-Host ("    {0,4}: {1}" -f $L, $lineText)
        }
      }
      Exit 2
    }
    continue
  }
}

if($inBlockComment -or $inSQ -or $inDQ -or $inBT){
  Write-Host ""
  Write-Host "[UNCLOSED] File ended while inside:"
  if($inBlockComment){ Write-Host " - block comment /* */" }
  if($inSQ){ Write-Host " - single-quote string '" }
  if($inDQ){ Write-Host ' - double-quote string "' }
  if($inBT){ Write-Host " - template string ` (backtick)" }
  Exit 3
}

if($stack.Count -gt 0){
  $top = $stack[$stack.Count - 1]
  $op = Get-LineCol $top.pos
  Write-Host ""
  Write-Host "[UNCLOSED] Stack not empty. Top is '$([char]$top.ch)' opened at line $($op.line), col $($op.col)"
  Write-Host "Open count remaining: $($stack.Count)"
  $startLine = [Math]::Max(1, $op.line - 4)
  $endLine = [Math]::Min($lineStarts.Count, $op.line + 4)
  Write-Host ""
  Write-Host "Context:"
  for($L=$startLine; $L -le $endLine; $L++){
    $lineText = Get-LineText $L
    if($L -eq $op.line){
      Write-Host ("--> {0,4}: {1}" -f $L, $lineText)
      Write-Host ("         {0}" -f (" " * ([Math]::Max(0, $op.col - 1)) + "^"))
    } else {
      Write-Host ("    {0,4}: {1}" -f $L, $lineText)
    }
  }
  Exit 4
}

Write-Host "[OK] No brace/paren/bracket mismatches detected by scanner."
Exit 0
'@

Set-Content -LiteralPath $diagPath -Value $scanner -Encoding UTF8
Write-Host "[OK] Wrote: $diagPath"

Write-Host ""
Write-Host "[RUN] Scanner:"
powershell -ExecutionPolicy Bypass -File $diagPath

Write-Host ""
Write-Host "[RUN] Build:"
npm.cmd run build
