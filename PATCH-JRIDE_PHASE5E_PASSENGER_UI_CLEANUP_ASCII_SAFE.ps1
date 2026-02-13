# PATCH-JRIDE_PHASE5E_PASSENGER_UI_CLEANUP_ASCII_SAFE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$repoRoot = (Get-Location).Path
$ts = Stamp

$targets = @(
  "app\passenger\page.tsx",
  "app\passenger-login\page.tsx",
  "app\passenger-signup\page.tsx"
)

function Backup-File($path){
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item $path $bak -Force
    Ok "[OK] Backup: $bak"
  }
}

function Normalize-Ascii([string]$s){
  if ($null -eq $s) { return $s }

  $s = $s -replace "^\uFEFF",""

  $s = $s.Replace([char]0x2013, '-')  # en dash
  $s = $s.Replace([char]0x2014, '-')  # em dash
  $s = $s.Replace([char]0x2212, '-')  # minus sign
  $s = $s.Replace([char]0x00A0, ' ')  # NBSP
  $s = $s.Replace([char]0x2018, "'")  # left single quote
  $s = $s.Replace([char]0x2019, "'")  # right single quote
  $s = $s.Replace([char]0x201C, '"')  # left double quote
  $s = $s.Replace([char]0x201D, '"')  # right double quote

  # Ellipsis: must be string replace (not char->char)
  $s = $s -replace ([regex]::Escape([string][char]0x2026)), "..."

  # Strip remaining non-ASCII
  $s = [regex]::Replace($s, "[^\x09\x0A\x0D\x20-\x7E]", "")

  # Canonicalize any "8PM ... 5AM" variant to (8PM-5AM)
  $s = [regex]::Replace($s, "\(\s*8PM[^)]*5AM\s*\)", "(8PM-5AM)")
  $s = [regex]::Replace($s, "\b8PM\s*-\s*5AM\b", "8PM-5AM")

  return $s
}

function Remove-BackToLoginOnPassengerPage([string]$s){
  if ($null -eq $s) { return $s }
  $s = [regex]::Replace($s, "(?is)\s*<button\b[^>]*>\s*Back\s+to\s+Login\s*</button>\s*", "`n")
  $s = [regex]::Replace($s, "(?is)\s*<a\b[^>]*>\s*Back\s+to\s+Login\s*</a>\s*", "`n")
  return $s
}

$changed = @()

foreach($rel in $targets){
  $path = Join-Path $repoRoot $rel
  if (-not (Test-Path $path)) {
    Warn "[SKIP] Not found: $rel"
    continue
  }

  Backup-File $path

  $orig = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $txt  = Normalize-Ascii $orig

  if ($rel -ieq "app\passenger\page.tsx") {
    $txt = Remove-BackToLoginOnPassengerPage $txt
    $txt = Normalize-Ascii $txt
  }

  if ($txt -ne $orig) {
    Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
    Ok "[OK] Patched: $rel"
    $changed += $rel
  } else {
    Warn "[NOCHANGE] $rel"
  }
}

Info ""
Info "[STEP] npm.cmd run build"
npm.cmd run build

Info ""
Info "[STEP] git add -A"
git add -A

$dirty = (git status --porcelain)
if ([string]::IsNullOrWhiteSpace($dirty)) {
  Warn "[WARN] Working tree clean (nothing to commit)."
  exit 0
}

$commitMsg = "JRIDE_PHASE5E passenger UI ASCII-safe + remove back-to-login"
Info ""
Info "[STEP] git commit -m `"$commitMsg`""
git commit -m $commitMsg

$tag = "JRIDE_PHASE5E_PASSENGER_UI_ASCII_" + (Get-Date -Format "yyyyMMdd_HHmmss")
Info ""
Info "[STEP] git tag $tag"
git tag $tag

Ok ""
Ok "[DONE] Commit + tag created: $tag"
Info "Next push:"
Info "  git push"
Info "  git push --tags"
