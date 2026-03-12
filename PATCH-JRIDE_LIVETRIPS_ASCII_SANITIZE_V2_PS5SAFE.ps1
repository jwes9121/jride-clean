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
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag,
    [Parameter(Mandatory=$true)][string]$BakDir
  )
  if (!(Test-Path -LiteralPath $Path)) {
    throw "Missing file: $Path"
  }
  if (!(Test-Path -LiteralPath $BakDir)) {
    New-Item -ItemType Directory -Path $BakDir | Out-Null
  }
  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
  $dest = Join-Path $BakDir ((Split-Path $Path -Leaf) + ".bak.$Tag.$ts")
  Copy-Item -LiteralPath $Path -Destination $dest -Force
  Write-Host "[OK] Backup: $dest"
}

function Get-NonAsciiSummary {
  param([string]$Text)
  $hits = @()
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $code = [int][char]$Text[$i]
    if ($code -gt 127) {
      $hits += ('U+{0:X4} at char {1}' -f $code, $i)
      if ($hits.Count -ge 20) { break }
    }
  }
  return $hits
}

function Sanitize-Ascii {
  param([string]$Text)

  # Remove BOM if present in content string
  if ($Text.Length -gt 0 -and [int][char]$Text[0] -eq 0xFEFF) {
    $Text = $Text.Substring(1)
  }

  # Common mojibake / unicode replacements first
  $pairs = @(
    @([char]0x2013, '-'),   # en dash
    @([char]0x2014, '-'),   # em dash
    @([char]0x2018, "'"),  # left single quote
    @([char]0x2019, "'"),  # right single quote
    @([char]0x201C, '"'),   # left double quote
    @([char]0x201D, '"'),   # right double quote
    @([char]0x2022, ' - '), # bullet
    @([char]0x2026, '...'), # ellipsis
    @([char]0x2265, '>='),  # >=
    @([char]0x2264, '<='),  # <=
    @([char]0x00A0, ' '),   # nbsp
    @([char]0x00B7, '-'),   # middle dot
    @([char]0x200B, ''),    # zero width space
    @([char]0xFEFF, '')     # BOM char if embedded
  )
  foreach ($p in $pairs) {
    $Text = $Text.Replace([string]$p[0], [string]$p[1])
  }

  # Fix common mojibake sequences explicitly
  $Text = $Text.Replace('â€“', '-')
  $Text = $Text.Replace('â€”', '-')
  $Text = $Text.Replace('â€˜', "'")
  $Text = $Text.Replace('â€™', "'")
  $Text = $Text.Replace('â€œ', '"')
  $Text = $Text.Replace('â€', '"')
  $Text = $Text.Replace('â€¢', ' - ')
  $Text = $Text.Replace('â€¦', '...')
  $Text = $Text.Replace('â‰¥', '>=')
  $Text = $Text.Replace('â‰¤', '<=')
  $Text = $Text.Replace('Â', '')

  # Final hard scrub: replace any remaining non-ASCII char with safe ASCII fallback
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $ch = $Text[$i]
    $code = [int][char]$ch
    if ($code -le 127) {
      [void]$sb.Append($ch)
    } else {
      switch ($code) {
        0x2013 { [void]$sb.Append('-') }
        0x2014 { [void]$sb.Append('-') }
        0x2018 { [void]$sb.Append("'") }
        0x2019 { [void]$sb.Append("'") }
        0x201C { [void]$sb.Append('"') }
        0x201D { [void]$sb.Append('"') }
        0x2022 { [void]$sb.Append(' - ') }
        0x2026 { [void]$sb.Append('...') }
        0x2265 { [void]$sb.Append('>=') }
        0x2264 { [void]$sb.Append('<=') }
        0x00A0 { [void]$sb.Append(' ') }
        0x00E2 { }
        0x0080 { }
        0x00A5 { }
        default { [void]$sb.Append('?') }
      }
    }
  }

  return $sb.ToString()
}

Write-Host '== PATCH JRIDE LIVETRIPS ASCII SANITIZE V2 (PS5-safe) =='
Write-Host "RepoRoot: $RepoRoot"

$repo = (Resolve-Path $RepoRoot).Path
$bakDir = Join-Path $repo '_patch_bak'

$targets = @(
  @{ Path = (Join-Path $repo 'app\admin\livetrips\LiveTripsClient.tsx'); Tag = 'LIVETRIPS_CLIENT_ASCII_SANITIZE_V2'; Label = 'LiveTripsClient.tsx' },
  @{ Path = (Join-Path $repo 'app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx'); Tag = 'SMART_ASSIGN_ASCII_SANITIZE_V2'; Label = 'SmartAutoAssignSuggestions.tsx' }
)

foreach ($t in $targets) {
  Backup-File -Path $t.Path -Tag $t.Tag -BakDir $bakDir
}

foreach ($t in $targets) {
  $text = [System.IO.File]::ReadAllText($t.Path)
  $clean = Sanitize-Ascii -Text $text
  $bad = Get-NonAsciiSummary -Text $clean
  if ($bad.Count -gt 0) {
    throw ($t.Label + ' still contains non-ASCII characters after sanitize: ' + ($bad -join ', '))
  }
  Write-Utf8NoBom -Path $t.Path -Content $clean
  Write-Host "[OK] Sanitized: $($t.Path)"
}

Write-Host '[DONE] LiveTrips ASCII sanitize V2 complete.'
