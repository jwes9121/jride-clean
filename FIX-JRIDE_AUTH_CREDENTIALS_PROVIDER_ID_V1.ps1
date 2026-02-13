# FIX-JRIDE_AUTH_CREDENTIALS_PROVIDER_ID_V1.ps1
# Removes custom Credentials provider id so NextAuth uses the stable "credentials" provider id.
# Backup + UTF-8 no BOM.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"
}

$root = (Get-Location).Path
$f = Join-Path $root "auth.ts"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

Backup $f
$txt = Get-Content $f -Raw

# Remove the exact id line if present
$txt2 = $txt -replace '^\s*id:\s*"passenger-credentials",\s*\r?\n', ""  # line-based removal

# Also remove if single-line formatted
$txt2 = $txt2 -replace '\s*id:\s*"passenger-credentials",\s*', ""

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt2, $enc)

Write-Host "[OK] Removed custom Credentials provider id. Use signIn('credentials')."
