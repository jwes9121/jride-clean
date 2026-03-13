param(
  [string]$ProjRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE LIVETRIPS ASCII CLEAN ==" -ForegroundColor Cyan
Write-Host "Root: $ProjRoot"

$targets = @(
  (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx")
)

foreach ($file in $targets) {
  if (-not (Test-Path $file)) {
    throw "Missing file: $file"
  }
}

$backupDir = Join-Path $ProjRoot "_patch_bak"
if (-not (Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Replace-CommonUnicode {
  param([string]$text)

  $map = @{}
  $map[[char]0x2018] = "'"
  $map[[char]0x2019] = "'"
  $map[[char]0x201A] = "'"
  $map[[char]0x201B] = "'"
  $map[[char]0x201C] = '"'
  $map[[char]0x201D] = '"'
  $map[[char]0x201E] = '"'
  $map[[char]0x201F] = '"'
  $map[[char]0x2013] = "-"
  $map[[char]0x2014] = "-"
  $map[[char]0x2026] = "..."
  $map[[char]0x00A0] = " "
  $map[[char]0x2002] = " "
  $map[[char]0x2003] = " "
  $map[[char]0x2009] = " "
  $map[[char]0x200B] = ""
  $map[[char]0x200C] = ""
  $map[[char]0x200D] = ""
  $map[[char]0x2060] = ""
  $map[[char]0xFEFF] = ""

  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    if ($map.ContainsKey($ch)) {
      [void]$sb.Append($map[$ch])
    } else {
      [void]$sb.Append($ch)
    }
  }
  return $sb.ToString()
}

function Strip-RemainingNonAscii {
  param([string]$text)

  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -eq 9 -or $code -eq 10 -or $code -eq 13 -or ($code -ge 32 -and $code -le 126)) {
      [void]$sb.Append($ch)
    } else {
      [void]$sb.Append("?")
    }
  }
  return $sb.ToString()
}

foreach ($file in $targets) {
  $name = Split-Path $file -Leaf
  $backup = Join-Path $backupDir ($name + ".bak.ASCII_CLEAN." + $stamp)
  Copy-Item $file $backup -Force
  Write-Host "[OK] Backup: $backup"

  $raw = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
  $clean = Replace-CommonUnicode -text $raw
  $clean = Strip-RemainingNonAscii -text $clean

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($file, $clean, $utf8NoBom)

  $bytes = [System.IO.File]::ReadAllBytes($file)
  $bad = @($bytes | Where-Object { $_ -gt 127 })
  if ($bad.Count -gt 0) {
    throw "Non-ASCII bytes still present in: $file"
  }

  Write-Host "[OK] ASCII-cleaned: $file"
}

Write-Host ""
Write-Host "== VERIFY =="
foreach ($file in $targets) {
  $bytes = [System.IO.File]::ReadAllBytes($file)
  $bad = @($bytes | Where-Object { $_ -gt 127 })
  Write-Host ("{0} -> bad-bytes: {1}" -f $file, $bad.Count)
}

Write-Host ""
Write-Host "[DONE] Re-run: npm run build" -ForegroundColor Green