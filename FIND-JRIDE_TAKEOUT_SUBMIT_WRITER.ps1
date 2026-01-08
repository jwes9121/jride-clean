# FIND-JRIDE_TAKEOUT_SUBMIT_WRITER.ps1
# Goal: Locate the exact code path that CREATES the takeout booking (API route OR client-side Supabase insert).
# Read-only. Safe.

$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path
Info "Repo root: $root"

# 1) Find any UI fetch() calls hitting /api (takeout-ish)
Info "Searching UI for fetch('/api/...') calls (takeout hints)..."
$uiHits = Get-ChildItem -Path (Join-Path $root "app") -Recurse -File -Include *.ts,*.tsx |
  Select-String -Pattern "fetch\(\s*['""]\/api\/" -ErrorAction SilentlyContinue

if ($uiHits) {
  Ok ("Found fetch('/api') hits: " + $uiHits.Count)
  $uiHits | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
} else {
  Warn "No fetch('/api/...') calls found in app/. UI may be using Supabase directly."
}

# 2) Find Supabase inserts into bookings (most likely submit path)
Info "Searching for bookings inserts (supabase.from('bookings').insert / .rpc that creates booking)..."
$bookInsertPatterns = @(
  "from\(\s*['""]bookings['""]\s*\)\s*\.insert",
  "insert\(\s*\[?.*booking",
  "service_type\s*:\s*['""]takeout['""]",
  "serviceType\s*:\s*['""]takeout['""]",
  "TAKEOUT",
  "vendor_status",
  "booking_code"
)

$hits = @()
foreach ($p in $bookInsertPatterns) {
  $hits += Get-ChildItem -Path (Join-Path $root "app") -Recurse -File -Include *.ts,*.tsx |
    Select-String -Pattern $p -ErrorAction SilentlyContinue
}

if ($hits -and $hits.Count -gt 0) {
  Ok ("Found potential submit-related hits: " + $hits.Count)
  $hits | Sort-Object Path, LineNumber | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
} else {
  Warn "No obvious bookings/takeout writer patterns found in app/. We'll search API routes next."
}

# 3) Search API routes for bookings insert (server-side creation)
Info "Searching app/api for bookings insert..."
$apiHits = Get-ChildItem -Path (Join-Path $root "app\api") -Recurse -File -Include route.ts |
  Select-String -Pattern "from\(\s*['""]bookings['""]\s*\)\s*\.insert" -ErrorAction SilentlyContinue

if ($apiHits) {
  Ok ("Found bookings insert in API routes: " + $apiHits.Count)
  $apiHits | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
} else {
  Warn "No bookings insert found in app/api route.ts files."
}

Info "DONE. The file that contains the REAL bookings insert for takeout is your submit writer."
Info "Next: upload ONLY the file that contains the takeout booking insert (the submit writer)."
