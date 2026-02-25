param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Info "== SETUP JRIDE: Node tooling (pnpm) + run dev/build (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $RepoRoot).Path
Info ("RepoRoot: " + $root)

# 1) Verify node + npm exist
Info "Checking node/npm..."
& node -v
& npm -v

# 2) Ensure Corepack is enabled (Node 16.13+/18+)
# Corepack manages pnpm/yarn without global installs.
Info "Enabling Corepack..."
try {
  & corepack --version | Out-Null
} catch {
  throw "corepack not found. Your Node install is missing Corepack. Install Node LTS 18+ then rerun."
}

& corepack enable | Out-Null

# 3) Ensure pnpm is activated
Info "Activating pnpm via Corepack..."
& corepack prepare pnpm@latest --activate | Out-Null

# 4) Confirm pnpm works
Info "Confirming pnpm..."
& pnpm -v

# 5) Install deps
Info "Installing dependencies..."
Push-Location $root
try {
  & pnpm install
} finally {
  Pop-Location
}

Ok "Dependencies installed."

# 6) RUN DEV SERVER
Info "Starting dev server (CTRL+C to stop)..."
Info "After it starts, test: http://localhost:3000/api/admin/driver_locations"
Push-Location $root
try {
  & pnpm dev
} finally {
  Pop-Location
}