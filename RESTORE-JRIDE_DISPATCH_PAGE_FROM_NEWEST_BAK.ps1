$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$dir  = Join-Path $root 'app\dispatch'
$cur  = Join-Path $dir  'page.tsx'

if (!(Test-Path $cur)) { Fail "Missing: app\dispatch\page.tsx (run from repo root)" }

# Find newest backup
$baks = Get-ChildItem -LiteralPath $dir -Filter 'page.tsx.bak.*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
if (!$baks -or $baks.Count -lt 1) { Fail "No backups found in app\dispatch (page.tsx.bak.*). Cannot restore safely." }

$best = $baks[0].FullName
Info "Newest backup: $($baks[0].Name)  ($($baks[0].LastWriteTime))"

# Backup current broken file
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$brokenBak = "$cur.broken.$ts"
Copy-Item -LiteralPath $cur -Destination $brokenBak -Force
Ok "[OK] Saved current broken file: $(Split-Path $brokenBak -Leaf)"

# Restore
Copy-Item -LiteralPath $best -Destination $cur -Force
Ok "[OK] Restored app\dispatch\page.tsx from: $(Split-Path $best -Leaf)"

Info "NEXT: npm run build"
