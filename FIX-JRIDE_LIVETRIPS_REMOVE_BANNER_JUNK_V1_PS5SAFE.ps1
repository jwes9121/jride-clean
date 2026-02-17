param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

Info "== JRIDE Fix: Remove banner junk lines (=====/----) from LiveTripsMap.tsx (V1 / PS5-safe) =="
Info "Root: $ProjRoot"

$map = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $map)) { Fail "[FAIL] Missing: $map" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.REMOVE_BANNER_JUNK_V1.$ts")
Copy-Item -LiteralPath $map -Destination $bak -Force
Ok "Backup: $bak"

$src = Get-Content -LiteralPath $map -Raw -ErrorAction Stop

$lines = $src -split "`r?`n"
$out = New-Object System.Collections.Generic.List[string]
$removed = 0

foreach ($ln in $lines) {
  $t = $ln.Trim()

  # Remove lines that are ONLY separators like "=====", "------", "_____", etc (and NOT commented)
  # If the line starts with // or {/* or */ or * then keep it (it's a comment)
  $isCommentLine = ($t -match '^(//|/\*|\*/|\*)')

  if (-not $isCommentLine) {
    # pure separator tokens
    if ($t -match '^[=\-_/]{3,}$') { $removed++; continue }

    # the broken emoji-mangled bytes line remnants (if any still exist)
    if ($t -match 'ðŸ') { $removed++; continue }

    # any accidental "=====" tail remnants containing ONLY "=" and spaces
    if ($t -match '^\s*={3,}\s*$') { $removed++; continue }
  }

  $out.Add($ln)
}

# Light cleanup: collapse too many blank lines
$clean = ($out -join "`r`n")
$clean = [System.Text.RegularExpressions.Regex]::Replace($clean, "(`r?`n){4,}", "`r`n`r`n`r`n", 0)

WriteUtf8NoBom -Path $map -Content $clean
Ok "[OK] Removed $removed junk line(s)"
Ok "[OK] Wrote: $map"
Ok "[OK] Done."
