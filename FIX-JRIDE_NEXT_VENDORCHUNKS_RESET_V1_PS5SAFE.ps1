# FIX-JRIDE_NEXT_VENDORCHUNKS_RESET_V1_PS5SAFE.ps1
# Fix: Next dev/build crashing with "Cannot find module './vendor-chunks/next.js'"
# Action: stop, nuke .next + node_modules + lock, clear npm cache, reinstall, build sanity check.
# PS5-safe.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$projRoot = (Get-Location).Path
Info "== JRide Fix: Next vendor-chunks reset (V1 / PS5-safe) =="
Info ("Project: " + $projRoot)

# Kill common Node/Next dev processes (safe best-effort)
$names = @("node","next")
foreach ($n in $names) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
Ok "[OK] Stopped node/next processes (best-effort)."

# Remove build artifacts + deps
$paths = @(".next","node_modules","package-lock.json")
foreach ($p in $paths) {
  $full = Join-Path $projRoot $p
  if (Test-Path $full) {
    Info ("Removing: " + $full)
    Remove-Item -Recurse -Force $full -ErrorAction SilentlyContinue
    Ok ("[OK] Removed: " + $p)
  } else {
    Info ("Skip (not found): " + $p)
  }
}

# Clear npm cache
try {
  Info "Clearing npm cache..."
  npm.cmd cache verify | Out-Null
  npm.cmd cache clean --force | Out-Null
  Ok "[OK] npm cache cleaned."
} catch {
  Warn "[WARN] npm cache clean had an issue, continuing..."
}

# Reinstall
Info "Installing dependencies..."
npm.cmd install
Ok "[OK] npm install complete."

# Sanity build (creates a clean .next)
Info "Running build sanity check..."
npm.cmd run build
Ok "[OK] npm run build passed."

Info ""
Ok "DONE. Next: start dev server: npm.cmd run dev"
