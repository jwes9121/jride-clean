# FIX-JRIDE_NEXT_DOCUMENT_NOT_FOUND_V1_PS5SAFE.ps1
# Fix Next.js build/dev cache corruption that triggers:
# PageNotFoundError: Cannot find module for page: /_document (ENOENT)
# PS5-safe. Creates backups only for safety logs; main action is cache cleanup.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
Info "== JRide Fix: Next /_document ENOENT (V1 / PS5-safe) =="
Info "Project: $root"

# 1) Show if there's an unexpected pages/ directory (not required, just info)
$pagesDir = Join-Path $root "pages"
if (Test-Path $pagesDir) {
  Warn "[WARN] Found /pages directory. If you don't use Pages Router, consider removing it (later) to avoid mixed-router edge cases."
  Get-ChildItem $pagesDir -File -Recurse | Select-Object FullName | ForEach-Object { Write-Host ("  " + $_.FullName) -ForegroundColor DarkYellow }
} else {
  Ok "[OK] No /pages directory detected (App Router only)."
}

# 2) Kill node/next processes (best-effort) so files unlock
$killed = 0
foreach ($p in @("node","next")) {
  try {
    Get-Process -Name $p -ErrorAction SilentlyContinue | ForEach-Object {
      try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; $killed++ } catch {}
    }
  } catch {}
}
Info ("[INFO] Stopped processes (best-effort): {0}" -f $killed)

# 3) Remove .next cache
$nextDir = Join-Path $root ".next"
if (Test-Path $nextDir) {
  Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
  Ok "[OK] Removed .next cache."
} else {
  Info "[INFO] .next not found (already clean)."
}

# 4) Optional: quick sanity check that next exists in node_modules
$nextPkg = Join-Path $root "node_modules\next\package.json"
if (!(Test-Path $nextPkg)) {
  Warn "[WARN] node_modules\next not found. Reinstalling dependencies..."
  if (Test-Path (Join-Path $root "package-lock.json")) {
    & npm.cmd ci
  } else {
    & npm.cmd install
  }
  Ok "[OK] Dependencies installed."
} else {
  Ok "[OK] next dependency exists in node_modules."
}

# 5) Run build (you can switch to dev if you want)
Info "[INFO] Running: npm.cmd run build"
& npm.cmd run build

Ok "[OK] Build command finished. If this is green, you're good."
Info "Next: run dev with npm.cmd run dev"
