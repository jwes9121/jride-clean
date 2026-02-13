# FIX-JRIDE_PHASE4A_ACTIONS_CONST_ACTION_UNESCAPE_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$target = "app\api\admin\livetrips\actions\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item -LiteralPath $target -Destination "$target.bak.$stamp" -Force
Info "Target: $target"
Ok   "Backup: $target.bak.$stamp"

$txt = Get-Content -LiteralPath $target -Raw

# 1) Fix the broken regex-literal line "const\s+action\s*=\s*String(...)" -> proper TS
# Match any line that starts with optional spaces then "const\ s+action" etc (literal backslash s)
$pattern = '(?m)^[ \t]*const\\s\+action\\s\*=\s\*String\(body\?\.\s*action\s*\|\|\s*""\)\.toUpperCase\(\)\s*as\s*ActionName;\s*$'
$replacement = '  const action = String(body?.action || "").toUpperCase() as ActionName;'

if ([regex]::IsMatch($txt, $pattern)) {
  $txt = [regex]::Replace($txt, $pattern, $replacement, 1)
  Ok "Replaced broken const\\s+action line with valid TypeScript."
} else {
  # Fallback: find ANY line containing "const\s+action" with backslashes and rewrite that whole line
  $fallback = '(?m)^[ \t]*const\\s\+action.*$'
  if ([regex]::IsMatch($txt, $fallback)) {
    $txt = [regex]::Replace($txt, $fallback, $replacement, 1)
    Ok "Fallback: rewrote the first 'const\\s+action...' line to valid TypeScript."
  } else {
    Fail "Could not find the broken 'const\\s+action' line. Paste lines 25-60 of $target."
  }
}

# 2) Safety: remove any other accidental '\s' tokens that appear on standalone 'const action' line
# (do NOT globally strip backslashes; only sanitize that specific const action line if it still contains '\')
$txt = [regex]::Replace(
  $txt,
  '(?m)^([ \t]*const\s+action\s*=.*)$',
  { param($m)
      $line = $m.Groups[1].Value
      if ($line -match '\\s|\\\(') {
        return '  const action = String(body?.action || "").toUpperCase() as ActionName;'
      }
      return $line
  },
  1
)

Write-Utf8NoBom $target $txt
Ok "Wrote $target (UTF-8 no BOM)."
Ok "Now run: npm run build"
