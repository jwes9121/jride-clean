param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE LiveTrips ASCII sanitize (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Get-Utf8NoBomEncoding {
  return New-Object System.Text.UTF8Encoding($false)
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[WARN] File not found for backup: $Path"
    return
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, (Get-Utf8NoBomEncoding))
}

function Show-NonAscii {
  param([Parameter(Mandatory=$true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[MISS] $Path"
    return
  }

  $text = Read-TextUtf8 -Path $Path
  $found = $false
  for ($i = 0; $i -lt $text.Length; $i++) {
    $code = [int][char]$text[$i]
    if ($code -gt 127) {
      $found = $true
      $prefix = $text.Substring(0, $i)
      $line = ($prefix -split "`n").Count
      $lineStart = $prefix.LastIndexOf("`n")
      if ($lineStart -lt 0) { $col = $i + 1 } else { $col = $i - $lineStart }
      Write-Host ("[NONASCII] {0} line={1} col={2} code={3}" -f $Path, $line, $col, $code)
    }
  }

  if (-not $found) {
    Write-Host "[ASCII OK] $Path"
  }
}

function Sanitize-ToAscii {
  param([Parameter(Mandatory=$true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[MISS] $Path"
    return
  }

  Backup-File -Path $Path -Tag "ASCII_SANITIZE_V1"

  $text = Read-TextUtf8 -Path $Path

  # Remove BOM if present
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 65279) {
    $text = $text.Substring(1)
    Write-Host "[FIX] Removed BOM: $Path"
  }

  # Normalize common Unicode punctuation to ASCII
  $text = $text.Replace([string][char]0x2013, "-")   # en dash
  $text = $text.Replace([string][char]0x2014, "-")   # em dash
  $text = $text.Replace([string][char]0x2018, "'")   # left single quote
  $text = $text.Replace([string][char]0x2019, "'")   # right single quote
  $text = $text.Replace([string][char]0x201C, '"')   # left double quote
  $text = $text.Replace([string][char]0x201D, '"')   # right double quote
  $text = $text.Replace([string][char]0x2022, "-")   # bullet
  $text = $text.Replace([string][char]0x00B7, "-")   # middle dot
  $text = $text.Replace([string][char]0x00A0, " ")   # nbsp
  $text = $text.Replace([string][char]0x2026, "...") # ellipsis

  # Strip anything still outside ASCII
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    $code = [int][char]$ch
    if ($code -le 127) {
      [void]$sb.Append($ch)
    } else {
      [void]$sb.Append("?")
    }
  }

  $out = $sb.ToString()
  Write-TextUtf8NoBom -Path $Path -Content $out
  Write-Host "[OK] Sanitized: $Path"
}

$targets = @(
  (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\TripWalletPanel.tsx"),
  (Join-Path $ProjRoot "app\admin\livetrips\components\TripLifecycleActions.tsx")
)

Write-Host ""
Write-Host "== BEFORE =="
foreach ($f in $targets) {
  Show-NonAscii -Path $f
}

Write-Host ""
Write-Host "== SANITIZE =="
foreach ($f in $targets) {
  Sanitize-ToAscii -Path $f
}

Write-Host ""
Write-Host "== AFTER =="
foreach ($f in $targets) {
  Show-NonAscii -Path $f
}

Write-Host ""
Write-Host "[DONE] LiveTrips files sanitized to ASCII / UTF-8 no BOM."