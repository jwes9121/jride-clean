param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Ensure-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required file not found: $Path"
  }
}

function Backup-File([string]$Path, [string]$Tag) {
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (-not (Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-Utf8Text([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
  Write-Host "[OK] Wrote: $Path"
}

function Assert-AsciiOnly([string]$Label, [string]$Text) {
  $bad = @()
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $c = [int][char]$Text[$i]
    if ($c -gt 127) {
      $bad += "U+$('{0:X4}' -f $c) at char $i"
      if ($bad.Count -ge 8) { break }
    }
  }
  if ($bad.Count -gt 0) {
    throw "$Label still contains non-ASCII characters: $($bad -join ', ')"
  }
}

function Sanitize-Ascii([string]$Text) {
  $t = $Text
  $t = $t.Replace([string][char]0xFEFF, '')   # BOM if present in decoded string
  $t = $t.Replace([string][char]0x2265, '>=') # ≥
  $t = $t.Replace([string][char]0x2014, '-')  # —
  $t = $t.Replace([string][char]0x2022, ' - ')# •
  $t = $t.Replace([string][char]0x2013, '-')  # – just in case
  return $t
}

Write-Host "== PATCH JRIDE LIVETRIPS ASCII SANITIZE V1 (PS5-safe) =="
Write-Host "RepoRoot: $RepoRoot"

$client = Join-Path $RepoRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$smart  = Join-Path $RepoRoot 'app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx'

Ensure-File $client
Ensure-File $smart

Backup-File $client 'LIVETRIPS_CLIENT_ASCII_SANITIZE_V1'
Backup-File $smart  'SMART_ASSIGN_ASCII_SANITIZE_V1'

$clientText = Read-Utf8Text $client
$smartText  = Read-Utf8Text $smart

$clientOut = Sanitize-Ascii $clientText
$smartOut  = Sanitize-Ascii $smartText

Assert-AsciiOnly 'LiveTripsClient.tsx' $clientOut
Assert-AsciiOnly 'SmartAutoAssignSuggestions.tsx' $smartOut

Write-Utf8NoBom $client $clientOut
Write-Utf8NoBom $smart  $smartOut

Write-Host '[DONE] ASCII sanitize complete.'
