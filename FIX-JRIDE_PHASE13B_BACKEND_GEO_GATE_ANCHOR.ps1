# FIX-JRIDE_PHASE13B_BACKEND_GEO_GATE_ANCHOR.ps1
# Phase 13-B: Insert backend geofence enforcement in app/api/public/passenger/book/route.ts
# Fixes anchor mismatch (your body parse uses req.json().catch(() => ({})))
# One file only. No manual edits.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\api\public\passenger\book\route.ts"
$path = Join-Path (Get-Location).Path $rel

if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# If geofence helper isn't present (in case earlier script didn't fully apply), add it after imports.
if ($txt -notmatch "function\s+inIfugaoBBox\s*\(") {
  # Insert after the import block at the top
  $impAnchor = "(?s)^(import\s+.*?;\s*import\s+.*?;\s*)"
  if ($txt -notmatch $impAnchor) { Fail "Import anchor not found. Paste first ~40 lines of route.ts." }

  $helper = @'
function inIfugaoBBox(lat: number, lng: number): boolean {
  // Conservative backend geofence (matches UI)
  return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
}

'@
  $txt = [regex]::Replace($txt, $impAnchor, "`$1`r`n$helper", 1)
  Ok "Inserted Ifugao geofence helper."
} else {
  Info "Geofence helper already present. Skipping helper insert."
}

# Insert enforcement immediately after your existing body parse line
if ($txt -match "PHASE13-B_BACKEND_GEO_GATE") {
  Info "Geo gate already present. No change."
  Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
  Ok "No-op (already patched)."
  exit 0
}

$bodyAnchor = [regex]::Escape('  const body = (await req.json().catch(() => ({}))) as BookReq;')
if ($txt -notmatch $bodyAnchor) {
  Fail "Body parse anchor not found. Expected:`n  const body = (await req.json().catch(() => ({}))) as BookReq;`nPaste the POST() header + first 40 lines inside POST()."
}

$gate = @'
  const body = (await req.json().catch(() => ({}))) as BookReq;

  // PHASE13-B_BACKEND_GEO_GATE
  // Booking must include location and must be inside Ifugao (conservative bbox).
  const lat = Number((body as any)?.pickup_lat);
  const lng = Number((body as any)?.pickup_lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { ok: false, code: "GEO_REQUIRED", message: "Location is required to book a ride." },
      { status: 400 }
    );
  }

  if (!inIfugaoBBox(lat, lng)) {
    return NextResponse.json(
      { ok: false, code: "GEO_OUTSIDE_IFUGAO", message: "Booking is only allowed inside Ifugao." },
      { status: 403 }
    );
  }

'@

$txt = [regex]::Replace($txt, $bodyAnchor, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $gate }, 1)

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Inserted Phase 13-B backend geo gate."
