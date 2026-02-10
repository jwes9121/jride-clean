# SET-JRIDE_MAPBOX_TOKEN_ENVLOCAL_V1_PS5SAFE.ps1
# Writes a clean canonical NEXT_PUBLIC_MAPBOX_TOKEN line to .env.local (UTF-8 no BOM),
# removing any existing NEXT_PUBLIC_MAPBOX_TOKEN / NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN lines.
# PS5-safe with backup.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$token = "pk.eyJ1IjoiandlczkxMjEiLCJhIjoiY21naHI0ZnV6MDE4ZjJqcjc4cjhyNHRiciJ9.6nRol7CbOMvh3D-qKmwalw"

$root = (Get-Location).Path
$envPath = Join-Path $root ".env.local"
$bakDir  = Join-Path $root "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

if (Test-Path $envPath) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item -LiteralPath $envPath -Destination (Join-Path $bakDir (".env.local.bak." + $stamp)) -Force
  Ok "[OK] Backup created in _patch_bak."
}

# Read existing (if any), normalize, remove mapbox lines
$text = ""
if (Test-Path $envPath) { $text = Get-Content -Raw -LiteralPath $envPath }

$text = $text -replace "`r`n","`n"
$text = $text -replace "`r","`n"
$lines = $text -split "`n", -1

$out = New-Object System.Collections.Generic.List[string]
foreach ($ln in $lines) {
  if ($ln -match '^\s*NEXT_PUBLIC_MAPBOX_(TOKEN|ACCESS_TOKEN)\s*=') { continue }
  $out.Add($ln.TrimEnd())
}

# Append canonical line
$out.Add("")
$out.Add("NEXT_PUBLIC_MAPBOX_TOKEN=$token")

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, ($out -join "`r`n"), $utf8NoBom)

Ok "[OK] Wrote .env.local with canonical NEXT_PUBLIC_MAPBOX_TOKEN (UTF-8 no BOM)."
Info "NEXT: Restart dev server (Ctrl+C, then npm.cmd run dev)."
