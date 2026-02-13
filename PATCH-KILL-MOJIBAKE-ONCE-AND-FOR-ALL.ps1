# PATCH-KILL-MOJIBAKE-ONCE-AND-FOR-ALL.ps1
# Finds & replaces mojibake sequences and unicode punctuation in repo files.
# Replaces:
#   - , â€¢ , â€¦  ->  " - " , " | " , "..."
#   —  , •  , …    ->  " - " , " | " , "..."
# Prints what it changed. No UI layout changes.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

# Target only code/text files (avoid node_modules/.next)
$includeExt = @("*.ts","*.tsx","*.js","*.jsx","*.json","*.md","*.css","*.scss","*.txt")

$excludeDirs = @(
  (Join-Path $root "node_modules"),
  (Join-Path $root ".next"),
  (Join-Path $root ".git")
)

function IsExcludedPath($p) {
  foreach ($d in $excludeDirs) {
    if ($p.StartsWith($d, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

# Unicode chars by codepoint (so script doesn’t depend on editor encoding)
$EM_DASH  = [string]([char]0x2014)  # —
$BULLET   = [string]([char]0x2022)  # •
$ELLIPSIS = [string]([char]0x2026)  # …

# Mojibake strings (ASCII-safe)
$MOJI_EMDASH = "-"
$MOJI_BULLET = "â€¢"
$MOJI_ELLIPS = "â€¦"

$repls = @(
  @{ from = $MOJI_EMDASH; to = " - " },
  @{ from = $MOJI_BULLET; to = " | " },
  @{ from = $MOJI_ELLIPS; to = "..." },
  @{ from = $EM_DASH;     to = " - " },
  @{ from = $BULLET;      to = " | " },
  @{ from = $ELLIPSIS;    to = "..." }
)

Write-Host "[1/3] Scanning files..." -ForegroundColor Cyan
$files = Get-ChildItem -Path $root -Recurse -File -Include $includeExt |
  Where-Object { -not (IsExcludedPath $_.FullName) }

if ($files.Count -eq 0) { Fail "No matching source files found to scan." }

$changed = @()

Write-Host "[2/3] Replacing mojibake/unicode separators..." -ForegroundColor Cyan
foreach ($fi in $files) {
  $path = $fi.FullName
  $txt = Get-Content -Raw -LiteralPath $path -ErrorAction SilentlyContinue
  if ($null -eq $txt) { continue }

  $orig = $txt
  foreach ($r in $repls) {
    if ($txt.Contains($r.from)) {
      $txt = $txt.Replace($r.from, $r.to)
    }
  }

  # Normalize spaces around separators (keeps labels readable)
  $txt = $txt -replace '\s+\|\s+', ' | '
  $txt = $txt -replace '\s+-\s+',  ' - '

  if ($txt -ne $orig) {
    # Use UTF8 explicitly
    Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
    $changed += $path
  }
}

Write-Host "[3/3] Done." -ForegroundColor Green
if ($changed.Count -eq 0) {
  Write-Host "No files contained -/â€¢/â€¦ or —/•/… . (So the string is coming from somewhere else at runtime.)" -ForegroundColor Yellow
} else {
  Write-Host ("Changed {0} file(s):" -f $changed.Count) -ForegroundColor Green
  $changed | ForEach-Object { Write-Host " - $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Stop dev server (Ctrl+C)" -ForegroundColor White
Write-Host "2) Run: npm run dev" -ForegroundColor White
Write-Host "3) Hard refresh browser (Ctrl+Shift+R)" -ForegroundColor White
