param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$verifyPath = Join-Path $ProjRoot "app\verify\page.tsx"
if (!(Test-Path -LiteralPath $verifyPath)) {
  throw "VERIFY_PAGE_NOT_FOUND: $verifyPath"
}

$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$ts = Stamp
$bakPath = Join-Path $bakDir ("page.tsx.bak.FIX_VERIFY_LOADUSER_EXTRA_BRACE_V1.$ts")
Copy-Item -LiteralPath $verifyPath -Destination $bakPath -Force
Write-Host "[OK] Backup: $bakPath"

$src = Get-Content -LiteralPath $verifyPath -Raw

# Fix the specific broken shape:
# setAuthUserPresent(true);
# }
# }
# };
$pattern = "(?s)(setAuthUserPresent\(\s*true\s*\);\s*\r?\n\s*\}\s*\r?\n)\s*\}\s*(\r?\n\s*\};)"
$m = [regex]::Match($src, $pattern)
if (-not $m.Success) {
  throw "PATCH_POINT_NOT_FOUND: could not find the double-'}' pattern after setAuthUserPresent(true)."
}

$replacement = $m.Groups[1].Value + $m.Groups[2].Value
$src = $src.Substring(0, $m.Index) + $replacement + $src.Substring($m.Index + $m.Length)

WriteUtf8NoBom $verifyPath $src
Write-Host "[OK] Removed extra '}' in loadUser()."
Write-Host "[OK] Patched (UTF-8 no BOM): $verifyPath"
Write-Host "[DONE] FIX_VERIFY_LOADUSER_EXTRA_BRACE_V1 applied."