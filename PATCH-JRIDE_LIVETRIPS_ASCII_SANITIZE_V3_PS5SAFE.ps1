param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag,
    [Parameter(Mandatory=$true)][string]$BakRoot
  )
  if (!(Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }
  if (!(Test-Path -LiteralPath $BakRoot)) { New-Item -ItemType Directory -Path $BakRoot | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $name = [System.IO.Path]::GetFileName($Path)
  $dest = Join-Path $BakRoot ("{0}.bak.{1}.{2}" -f $name, $Tag, $stamp)
  Copy-Item -LiteralPath $Path -Destination $dest -Force
  Write-Host "[OK] Backup: $dest"
}

function Get-FileTextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path)
}

function Remove-Bom {
  param([string]$Text)
  if ($Text.Length -gt 0 -and [int][char]$Text[0] -eq 0xFEFF) {
    return $Text.Substring(1)
  }
  return $Text
}

function Replace-Literal {
  param(
    [string]$Text,
    [string]$Find,
    [string]$With
  )
  if ([string]::IsNullOrEmpty($Find)) { return $Text }
  return $Text.Replace($Find, $With)
}

function Sanitize-Ascii {
  param([Parameter(Mandatory=$true)][string]$Text)

  $t = Remove-Bom $Text

  # Proper Unicode punctuation/operators
  $t = Replace-Literal $t ([string][char]0x2013) '-'
  $t = Replace-Literal $t ([string][char]0x2014) '-'
  $t = Replace-Literal $t ([string][char]0x2026) '...'
  $t = Replace-Literal $t ([string][char]0x2022) ' - '
  $t = Replace-Literal $t ([string][char]0x2018) "'"
  $t = Replace-Literal $t ([string][char]0x2019) "'"
  $t = Replace-Literal $t ([string][char]0x201C) '"'
  $t = Replace-Literal $t ([string][char]0x201D) '"'
  $t = Replace-Literal $t ([string][char]0x2265) '>='
  $t = Replace-Literal $t ([string][char]0x2264) '<='
  $t = Replace-Literal $t ([string][char]0x00A0) ' '

  # Common mojibake sequences expressed safely with char codes
  $seq_ge = ([string][char]0x00E2) + [char]0x2030 + [char]0x00A5   # â‰¥
  $seq_le = ([string][char]0x00E2) + [char]0x2030 + [char]0x00A4   # â‰¤
  $seq_nd = ([string][char]0x00E2) + [char]0x20AC + [char]0x0153   # â€“
  $seq_md = ([string][char]0x00E2) + [char]0x20AC + [char]0x201D   # â€”
  $seq_ls = ([string][char]0x00E2) + [char]0x20AC + [char]0x02DC   # â˜? sometimes left single quote mojibake path
  $seq_rs = ([string][char]0x00E2) + [char]0x20AC + [char]0x2122   # â€™
  $seq_lq = ([string][char]0x00E2) + [char]0x20AC + [char]0x015C   # â€œ
  $seq_rq = ([string][char]0x00E2) + [char]0x20AC + [char]0x009D   # rare
  $seq_bu = ([string][char]0x00E2) + [char]0x20AC + [char]0x00A2   # â€¢
  $seq_el = ([string][char]0x00E2) + [char]0x20AC + [char]0x00A6   # â€¦

  $t = Replace-Literal $t $seq_ge '>='
  $t = Replace-Literal $t $seq_le '<='
  $t = Replace-Literal $t $seq_nd '-'
  $t = Replace-Literal $t $seq_md '-'
  $t = Replace-Literal $t $seq_ls "'"
  $t = Replace-Literal $t $seq_rs "'"
  $t = Replace-Literal $t $seq_lq '"'
  $t = Replace-Literal $t $seq_rq '"'
  $t = Replace-Literal $t $seq_bu ' - '
  $t = Replace-Literal $t $seq_el '...'

  # Target the exact sequence proven by the build error even if present as separate codepoints
  $t = $t -replace ([regex]::Escape(([string][char]0x00E2) + [char]0x2030 + [char]0x00A5)), '>='

  # Final hard scrub: any remaining non-ASCII becomes a plain space
  $t = [regex]::Replace($t, '[^\u0000-\u007F]', ' ')

  # Normalize spacing introduced by scrub
  $t = [regex]::Replace($t, ' {2,}', ' ')

  return $t
}

function Assert-AsciiOnly {
  param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][string]$Label
  )
  $bad = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $cp = [int][char]$Text[$i]
    if ($cp -gt 127) {
      $bad.Add(("U+{0:X4} at char {1}" -f $cp, $i))
      if ($bad.Count -ge 12) { break }
    }
  }
  if ($bad.Count -gt 0) {
    throw "$Label still contains non-ASCII characters: $($bad -join ', ')"
  }
}

Write-Host '== PATCH JRIDE LIVETRIPS ASCII SANITIZE V3 (PS5-safe) =='
Write-Host "RepoRoot: $RepoRoot"

$client = Join-Path $RepoRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$smart  = Join-Path $RepoRoot 'app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx'
$bakRoot = Join-Path $RepoRoot '_patch_bak'

Backup-File -Path $client -Tag 'LIVETRIPS_CLIENT_ASCII_SANITIZE_V3' -BakRoot $bakRoot
Backup-File -Path $smart  -Tag 'SMART_ASSIGN_ASCII_SANITIZE_V3'     -BakRoot $bakRoot

$clientText = Get-FileTextUtf8 -Path $client
$smartText  = Get-FileTextUtf8 -Path $smart

$clientOut = Sanitize-Ascii -Text $clientText
$smartOut  = Sanitize-Ascii -Text $smartText

Assert-AsciiOnly -Text $clientOut -Label 'LiveTripsClient.tsx'
Assert-AsciiOnly -Text $smartOut  -Label 'SmartAutoAssignSuggestions.tsx'

Write-Utf8NoBom -Path $client -Content $clientOut
Write-Utf8NoBom -Path $smart  -Content $smartOut

Write-Host "[OK] Wrote: $client"
Write-Host "[OK] Wrote: $smart"
Write-Host '[DONE] ASCII sanitation complete.'
