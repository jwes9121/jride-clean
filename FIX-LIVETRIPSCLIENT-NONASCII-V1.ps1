param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Write-Section($t) {
  Write-Host ""
  Write-Host ("=" * 100)
  Write-Host $t
  Write-Host ("=" * 100)
}

function Get-TargetPath {
  param([string]$Root)
  return Join-Path $Root "app\admin\livetrips\LiveTripsClient.tsx"
}

function Get-BackupDir {
  param([string]$Root)
  return Join-Path $Root "app\admin\livetrips\_ascii_bak"
}

function Get-ByteReport {
  param([byte[]]$Bytes)

  $bad = New-Object System.Collections.Generic.List[object]
  for ($i = 0; $i -lt $Bytes.Length; $i++) {
    if ($Bytes[$i] -gt 127) {
      $bad.Add([pscustomobject]@{
        Index = $i
        Byte  = $Bytes[$i]
      })
    }
  }
  return $bad
}

function Get-LineMap {
  param([byte[]]$Bytes)

  $line = 1
  $col = 1
  $map = @{}

  for ($i = 0; $i -lt $Bytes.Length; $i++) {
    $map[$i] = [pscustomobject]@{
      Line = $line
      Col  = $col
    }

    if ($Bytes[$i] -eq 10) {
      $line++
      $col = 1
    }
    else {
      $col++
    }
  }

  return $map
}

function Get-ContextAscii {
  param(
    [byte[]]$Bytes,
    [int]$Index,
    [int]$Radius = 20
  )

  $start = [Math]::Max(0, $Index - $Radius)
  $end = [Math]::Min($Bytes.Length - 1, $Index + $Radius)
  $slice = $Bytes[$start..$end]

  $chars = foreach ($b in $slice) {
    if ($b -ge 32 -and $b -le 126) {
      [char]$b
    }
    elseif ($b -eq 9) {
      "`t"
    }
    elseif ($b -eq 10) {
      "`n"
    }
    elseif ($b -eq 13) {
      "`r"
    }
    else {
      "."
    }
  }

  -join $chars
}

function Normalize-ToAscii {
  param([string]$Text)

  $map = @{
    [char]0x2018 = "'"
    [char]0x2019 = "'"
    [char]0x201C = '"'
    [char]0x201D = '"'
    [char]0x2013 = "-"
    [char]0x2014 = "-"
    [char]0x2026 = "..."
    [char]0x00A0 = " "
    [char]0x2265 = ">="
    [char]0x2010 = "-"
    [char]0x2011 = "-"
    [char]0x2012 = "-"
    [char]0x2015 = "-"
  }

  $sb = New-Object System.Text.StringBuilder

  foreach ($ch in $Text.ToCharArray()) {
    $code = [int][char]$ch

    if ($code -le 127) {
      [void]$sb.Append($ch)
    }
    elseif ($map.ContainsKey($ch)) {
      [void]$sb.Append($map[$ch])
    }
    else {
      # Drop any remaining non-ASCII characters rather than guessing.
    }
  }

  return $sb.ToString()
}

function Write-AsciiNoBom {
  param(
    [string]$Path,
    [string]$Text
  )

  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

$target = Get-TargetPath -Root $WebRoot
$backupDir = Get-BackupDir -Root $WebRoot

Write-Section "1. VERIFY TARGET"
if (-not (Test-Path -LiteralPath $target)) {
  throw "Target file not found: $target"
}
Write-Host "FOUND: $target"

Write-Section "2. READ RAW BYTES"
[byte[]]$bytesBefore = [System.IO.File]::ReadAllBytes($target)
Write-Host ("Byte length: " + $bytesBefore.Length)

$badBefore = Get-ByteReport -Bytes $bytesBefore
Write-Host ("Non-ASCII byte count before fix: " + $badBefore.Count)

if ($badBefore.Count -gt 0) {
  $lineMap = Get-LineMap -Bytes $bytesBefore
  Write-Host ""
  Write-Host "First offending bytes:"
  $badBefore | Select-Object -First 20 | ForEach-Object {
    $pos = $lineMap[$_.Index]
    $ctx = Get-ContextAscii -Bytes $bytesBefore -Index $_.Index -Radius 20
    Write-Host ("Index={0} Byte={1} Line={2} Col={3} Context={4}" -f $_.Index, $_.Byte, $pos.Line, $pos.Col, $ctx)
  }
} else {
  Write-Host "No non-ASCII bytes detected before fix."
}

Write-Section "3. BACKUP CURRENT FILE"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.NONASCII_FIX_" + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Write-Host "BACKUP: $backup"

Write-Section "4. NORMALIZE TEXT TO ASCII ONLY"
$text = [System.IO.File]::ReadAllText($target)
$fixed = Normalize-ToAscii -Text $text

# Normalize line endings to CRLF for Windows consistency
$fixed = $fixed -replace "`r?`n", "`r`n"

Write-AsciiNoBom -Path $target -Text $fixed
Write-Host "Rewrote target as ASCII-safe UTF-8 without BOM."

Write-Section "5. VERIFY RAW BYTES AFTER FIX"
[byte[]]$bytesAfter = [System.IO.File]::ReadAllBytes($target)
$badAfter = Get-ByteReport -Bytes $bytesAfter
Write-Host ("Non-ASCII byte count after fix: " + $badAfter.Count)

if ($bytesAfter.Length -ge 3) {
  $bom = ($bytesAfter[0] -eq 239 -and $bytesAfter[1] -eq 187 -and $bytesAfter[2] -eq 191)
  Write-Host ("UTF-8 BOM present: " + $bom)
} else {
  Write-Host "UTF-8 BOM present: False"
}

if ($badAfter.Count -gt 0) {
  throw "File still contains non-ASCII bytes after rewrite."
}

Write-Section "6. OPTIONAL BUILD-GUARD CHECK"
$checkScript = Join-Path $WebRoot "scripts\check-livetrips-ascii.js"
if (Test-Path -LiteralPath $checkScript) {
  Write-Host "Found checker: $checkScript"
  try {
    Push-Location $WebRoot
    node $checkScript
    Pop-Location
    Write-Host "ASCII checker passed."
  }
  catch {
    try { Pop-Location } catch {}
    throw
  }
}
else {
  Write-Host "ASCII checker script not found; skipped direct checker run."
}

Write-Section "DONE"
Write-Host "Target file is now ASCII-safe and BOM-free:"
Write-Host $target