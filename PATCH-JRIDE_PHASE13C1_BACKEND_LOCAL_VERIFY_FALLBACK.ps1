# PATCH-JRIDE_PHASE13C1_BACKEND_LOCAL_VERIFY_FALLBACK.ps1
# Phase 13-C1: Backend local verification fallback for booking API
# File: app/api/public/passenger/book/route.ts
# One file only. No DB assumptions.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

$rel = "app\api\public\passenger\book\route.ts"
$path = Join-Path (Get-Location).Path $rel

if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Anchor: the geofence block we inserted earlier includes "PHASE13-B_BACKEND_GEO_GATE"
$anchor = [regex]::Escape('// PHASE13-B_BACKEND_GEO_GATE')
if ($txt -notmatch $anchor) {
  Fail "Could not find // PHASE13-B_BACKEND_GEO_GATE in route.ts. This patch expects Phase 13-B to be present."
}

# Insert local verification logic right after the PHASE13-B marker
$pattern = "(?s)// PHASE13-B_BACKEND_GEO_GATE\s*.*?\r?\n\s*// Booking must include location and must be inside Ifugao \(conservative bbox\)\.\s*\r?\n\s*const lat = Number\(\(body as any\)\?\.(?:pickup_lat)\);\s*\r?\n\s*const lng = Number\(\(body as any\)\?\.(?:pickup_lng)\);\s*\r?\n"
if ($txt -notmatch $pattern) {
  Fail "Expected Phase 13-B block shape not found. Paste the Phase 13-B section from route.ts."
}

$replacement = @'
// PHASE13-B_BACKEND_GEO_GATE
  // Booking must include location and must be inside Ifugao (conservative bbox).
  // Phase 13-C1: allow a local verification code fallback (QR/referral/admin code).
  const expectedLocal = String(process.env.JRIDE_LOCAL_VERIFY_CODE || "").trim();
  const providedLocal = String(((body as any)?.local_verification_code || (body as any)?.local_verify || "")).trim();
  const localOk = !!expectedLocal && !!providedLocal && (providedLocal === expectedLocal);

  const lat = Number((body as any)?.pickup_lat);
  const lng = Number((body as any)?.pickup_lng);

'@

$txt = [regex]::Replace($txt, $pattern, $replacement, 1)

# Now modify the GEO_REQUIRED and OUTSIDE checks to skip if localOk is true
# 1) GEO_REQUIRED block: wrap with !localOk
$txt2 = $txt
$txt2 = [regex]::Replace(
  $txt2,
  "(?s)\r?\n\s*if\s*\(\s*!\s*Number\.isFinite\(lat\)\s*\|\|\s*!\s*Number\.isFinite\(lng\)\s*\)\s*\{\s*return\s+NextResponse\.json\(\s*\{\s*ok:\s*false,\s*code:\s*""GEO_REQUIRED"",\s*message:\s*""Location is required to book a ride\.""\s*\}\s*,\s*\{\s*status:\s*400\s*\}\s*\);\s*\}\s*\r?\n",
  "`r`n  if (!localOk && (!Number.isFinite(lat) || !Number.isFinite(lng))) {`r`n    return NextResponse.json(`r`n      { ok: false, code: ""GEO_REQUIRED"", message: ""Location is required to book a ride."" },`r`n      { status: 400 }`r`n    );`r`n  }`r`n"
)

# 2) OUTSIDE check: skip if localOk OR lat/lng missing (because missing already handled unless localOk)
$txt2 = [regex]::Replace(
  $txt2,
  "(?s)\r?\n\s*if\s*\(\s*!\s*inIfugaoBBox\(lat,\s*lng\)\s*\)\s*\{\s*return\s+NextResponse\.json\(\s*\{\s*ok:\s*false,\s*code:\s*""GEO_OUTSIDE_IFUGAO"",\s*message:\s*""Booking is only allowed inside Ifugao\.""\s*\}\s*,\s*\{\s*status:\s*403\s*\}\s*\);\s*\}\s*\r?\n",
  "`r`n  if (!localOk && Number.isFinite(lat) && Number.isFinite(lng) && !inIfugaoBBox(lat, lng)) {`r`n    return NextResponse.json(`r`n      { ok: false, code: ""GEO_OUTSIDE_IFUGAO"", message: ""Booking is only allowed inside Ifugao."" },`r`n      { status: 403 }`r`n    );`r`n  }`r`n"
)

$txt = $txt2

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-C1 backend local verification fallback added."
