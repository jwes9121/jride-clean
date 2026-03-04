param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "== FIX JRIDE: LiveTripsMap ASCII-only sanitizer (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $target)) {
  $alt = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsMap.tsx"
  if (Test-Path -LiteralPath $alt) { $target = $alt }
  else { throw "LiveTripsMap.tsx not found at expected paths." }
}

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.ASCII_ONLY_V1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Read as raw text
$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Common offending characters -> ASCII equivalents
$repl = @(
  @{ from = [char]0x00A0; to = " "  },  # NBSP
  @{ from = [char]0x200B; to = ""   },  # zero-width space
  @{ from = [char]0x2018; to = "'"  },  # left single quote
  @{ from = [char]0x2019; to = "'"  },  # right single quote
  @{ from = [char]0x201C; to = '"'  },  # left double quote
  @{ from = [char]0x201D; to = '"'  },  # right double quote
  @{ from = [char]0x2013; to = "-"  },  # en dash
  @{ from = [char]0x2014; to = "--" },  # em dash
  @{ from = [char]0x2026; to = "..."},  # ellipsis
  @{ from = [char]0x2212; to = "-"  }   # minus sign
)

foreach ($r in $repl) {
  $content = $content.Replace([string]$r.from, [string]$r.to)
}

# Remove diacritics by Unicode normalization (FormD) then strip combining marks
# This keeps ASCII for any accidental accented characters.
$norm = $content.Normalize([Text.NormalizationForm]::FormD)
$sb = New-Object System.Text.StringBuilder
foreach ($ch in $norm.ToCharArray()) {
  $cat = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
  if ($cat -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
    [void]$sb.Append($ch)
  }
}
$content = $sb.ToString()

# Hard drop any remaining non-ASCII (should be none after above); replace with '?'
$bytesBad = 0
$sb2 = New-Object System.Text.StringBuilder
foreach ($ch in $content.ToCharArray()) {
  if ([int][char]$ch -le 127) {
    [void]$sb2.Append($ch)
  } else {
    $bytesBad++
    [void]$sb2.Append("?")
  }
}
$content = $sb2.ToString()

# Write UTF-8 WITHOUT BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)

if ($bytesBad -gt 0) {
  Write-Host "[WARN] Replaced $bytesBad remaining non-ASCII chars with '?' (unexpected after normalization)."
} else {
  Write-Host "[OK] No remaining non-ASCII chars after sanitation."
}

Write-Host "[OK] Wrote: $target"
Write-Host "NEXT: npm run build"