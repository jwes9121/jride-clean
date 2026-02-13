# PATCH-JRIDE_FIX_MOJIBAKE_SAFE.ps1
# Fix common mojibake sequences safely across app/**/*.ts, app/**/*.tsx, app/**/route.ts
# Writes UTF-8 NO BOM. Creates .bak timestamped backups per changed file.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function OK($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

function NowStamp {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function ReadUtf8Text([string]$path) {
  # Read raw bytes, decode as UTF8 (no BOM needed; decoder will handle if present)
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $utf8 = New-Object System.Text.UTF8Encoding($false,$false)
  return $utf8.GetString($bytes)
}

function WriteUtf8NoBom([string]$path, [string]$text) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}

function MakeStr([int[]]$codes) {
  $chars = New-Object 'System.Collections.Generic.List[char]'
  foreach ($c in $codes) { [void]$chars.Add([char]$c) }
  return -join $chars.ToArray()
}

# Build mojibake tokens WITHOUT embedding them in the script source
# These are the exact common sequences you’re seeing (e.g., todayÃ¢â‚¬â„¢s, Ã¢Ë†', etc.)
$tok_open_quote_1 = MakeStr @(0x00C3,0x00A2,0x00E2,0x201A,0x00AC,0x00C5,0x201C) # "Ã¢â‚¬Å“"
$tok_close_quote_1 = MakeStr @(0x00C3,0x00A2,0x00E2,0x201A,0x00AC,0x00C2,0x201C) # "Ã¢â‚¬“" (variant)
$tok_close_quote_2 = MakeStr @(0x00C3,0x00A2,0x00E2,0x201A,0x00AC,0x00C2,0x201D) # "Ã¢â‚¬”" (variant)

$tok_apostrophe = MakeStr @(0x00C3,0x00A2,0x00E2,0x201A,0x00AC,0x00E2,0x201E,0x00A2) # "Ã¢â‚¬â„¢"
$tok_ellipsis  = MakeStr @(0x00C3,0x00A2,0x00E2,0x201A,0x00AC,0x00C2,0x00A6) # "Ã¢â‚¬¦"
$tok_dash_like = MakeStr @(0x00C3,0x00A2,0x00CB,0x2020,0x00E2,0x20AC,0x2122) # "Ã¢Ë†'"

# Some files contain smaller “stray” sequences too; keep these conservative
$tok_nbsp_Acirc = MakeStr @(0x00C3,0x00A2,0x00C2,0x00A0) # "Ã¢ " (rare)
$tok_Acirc_only = MakeStr @(0x00C2,0x00A0)              # " " (nbsp shown as " ")

# Replacement rules (ASCII-safe)
$rules = @(
  @{ from = $tok_open_quote_1;  to = '"'  },
  @{ from = $tok_close_quote_1; to = '"'  },
  @{ from = $tok_close_quote_2; to = '"'  },

  @{ from = $tok_apostrophe;    to = "'"  },
  @{ from = $tok_ellipsis;      to = "..." },
  @{ from = $tok_dash_like;     to = "-"  },

  # Conservative whitespace cleanups (optional, safe)
  @{ from = $tok_nbsp_Acirc;    to = " "  },
  @{ from = $tok_Acirc_only;    to = " "  }
)

# Repo root = current folder
$root = (Get-Location).Path
$targetRoot = Join-Path $root "app"
if (!(Test-Path $targetRoot)) { Fail "Cannot find app/ folder in: $root" }

$stamp = NowStamp
Info "Repo root: $root"
Info "Scanning: $targetRoot"

# Collect target files
$files = Get-ChildItem -Path $targetRoot -Recurse -File -ErrorAction Stop |
  Where-Object {
    $_.Extension -in @(".ts", ".tsx") -or $_.Name -ieq "route.ts"
  }

if (!$files -or $files.Count -eq 0) { Fail "No target files found under app/." }

$changed = 0
$totalMarkersBefore = 0
$totalMarkersAfter  = 0

foreach ($f in $files) {
  $path = $f.FullName
  $orig = ReadUtf8Text $path

  # Quick check: if it doesn't contain the typical start, skip heavy work
  $maybe = ($orig.IndexOf([char]0x00C3) -ge 0) -or ($orig.IndexOf([char]0x00C2) -ge 0)
  if (-not $maybe) { continue }

  $txt = $orig

  $markersBefore = 0
  foreach ($r in $rules) {
    if ([string]::IsNullOrEmpty($r.from)) { continue }
    $markersBefore += ([regex]::Matches($txt, [regex]::Escape($r.from))).Count
  }

  if ($markersBefore -eq 0) { continue }

  foreach ($r in $rules) {
    if ([string]::IsNullOrEmpty($r.from)) { continue }
    $txt = $txt.Replace($r.from, [string]$r.to)
  }

  $markersAfter = 0
  foreach ($r in $rules) {
    if ([string]::IsNullOrEmpty($r.from)) { continue }
    $markersAfter += ([regex]::Matches($txt, [regex]::Escape($r.from))).Count
  }

  if ($txt -ne $orig) {
    $bak = "$path.bak.$stamp"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    WriteUtf8NoBom $path $txt
    $changed++
    $totalMarkersBefore += $markersBefore
    $totalMarkersAfter  += $markersAfter
    OK ("Patched: {0} (markers {1} -> {2})" -f ($path.Substring($root.Length).TrimStart("\","/")), $markersBefore, $markersAfter)
  }
}

Info ("Done. Files changed: {0}. Total markers: {1} -> {2}" -f $changed, $totalMarkersBefore, $totalMarkersAfter)

if ($changed -eq 0) {
  Warn "No changes were made. If the UI still shows mojibake, the string may be coming from cached/old build or a different file path."
  exit 0
}

OK "Next: run build, then commit + push to trigger Vercel."
