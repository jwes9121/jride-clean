# FIX-JRIDE_INSTALL_SUPABASE_SSR_V1_PS5SAFE.ps1
# Goal: Install missing dependency @supabase/ssr to fix build:
#   Module not found: Can't resolve '@supabase/ssr'
# PS5-safe. Runs in repo root.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; throw $m }

Write-Host "== JRide Fix: Install @supabase/ssr (V1 / PS5-safe) ==" -ForegroundColor Cyan

$RepoRoot = (Resolve-Path ".").Path
$PkgJson = Join-Path $RepoRoot "package.json"
if (!(Test-Path $PkgJson)) { Die "package.json not found. Run this from repo root: $RepoRoot" }

Ok "[OK] RepoRoot: $RepoRoot"

# Ensure npm.cmd exists
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $npm) { Die "npm.cmd not found in PATH. Install Node.js or open a new terminal after install." }

# Install dependency
Write-Host ""
Ok "[OK] Installing: @supabase/ssr"
& npm.cmd install @supabase/ssr
if ($LASTEXITCODE -ne 0) { Die "npm install failed (exit $LASTEXITCODE)." }

# Quick sanity check: node_modules presence
$SsrPath = Join-Path $RepoRoot "node_modules\@supabase\ssr"
if (!(Test-Path $SsrPath)) {
  Warn "[WARN] node_modules\@supabase\ssr not found after install. Checking npm list..."
  & npm.cmd ls @supabase/ssr
  if ($LASTEXITCODE -ne 0) { Die "Dependency still not resolved. npm ls failed." }
}

Ok "[OK] Installed: @supabase/ssr"

Write-Host ""
Ok "[OK] DONE. Next: npm.cmd run build"
