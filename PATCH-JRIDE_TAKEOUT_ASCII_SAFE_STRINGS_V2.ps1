# PATCH-JRIDE_TAKEOUT_ASCII_SAFE_STRINGS_V2.ps1
# Remove mojibake by converting Unicode punctuation to ASCII in app/takeout/page.tsx
# Does NOT include mojibake text literals (parser-safe).
# UTF-8 no BOM + backup.

$ErrorActionPreference = "Stop"

function OK($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function INFO($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function FAIL($m){ throw $m }
function TS(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  try { $sw.Write($content) } finally { $sw.Dispose() }
}

$target = "app\takeout\page.tsx"
if (!(Test-Path $target)) { FAIL "Missing $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
OK "Backup: $bak"

$txt  = Get-Content -Raw $target
$orig = $txt

# 1) Replace common Unicode punctuation (by codepoint)
$map = @(
  @{ from = 0x2019; to = "'"  }, # ’
  @{ from = 0x2018; to = "'"  }, # ‘
  @{ from = 0x201C; to = '"'  }, # “
  @{ from = 0x201D; to = '"'  }, # ”
  @{ from = 0x2014; to = "--" }, # —
  @{ from = 0x2013; to = "-"  }  # –
)

foreach ($m in $map) {
  $txt = $txt.Replace([char]$m.from, [string]$m.to)
}

# 2) Extra hardening: remove sequences beginning with U+00C3 (Ã) that commonly indicate mojibake.
$txt = [regex]::Replace(
  $txt,
  ([string][char]0x00C3) + "[\u00A2\u00A0\u00A9\u00AE\u0082\u0080\u0099\u009C\u009D\u2013\u2014\u2122\u00A1\u00BF\u00B4\u00B2\u00B3\u00BD\u00BE\u00BC\u00B1\u00A7\u00A8\u00AF\u00B8\u00BA\u00AA\u00E2\u0080\u0099\u0080\u0094\u0080\u0093\u0080\u009C\u0080\u009D\u0080\u00A6\u0080\u00A2\u0080\u00A8\u00C2\u00A0\u00C2\u00B4\u00C2\u00B1\u00C2\u00A3]*",
  ""
)

if ($txt -eq $orig) {
  INFO "No changes detected (file may already be ASCII-safe)."
} else {
  WriteUtf8NoBom $target $txt
  OK "Patched: $target (ASCII-safe strings written UTF-8 no BOM)."
}