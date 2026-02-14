param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: Passenger booking endpoint can DISCOVER active booking + returns fare fields (V1 / PS5-safe) ==" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"
if (-not (Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("public-passenger-booking.route.ts.bak.DISCOVER_ACTIVE_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $target -Raw

# 1) Ensure Resp has booking?: any; (your snippet already shows it, but make it idempotent)
if ($txt -notmatch 'booking\?\s*:\s*any\s*;') {
  $txt = [regex]::Replace(
    $txt,
    '(type\s+Resp\s*=\s*\{)',
    '$1' + "`r`n    booking?: any;",
    1
  )
  Ok "[OK] Added booking?: any to Resp"
}

# 2) Replace the "if (!bookingCode) return 400" gate with discover-active logic
$patGate = '(?s)const\s+url\s*=\s*new\s+URL\(req\.url\);\s*const\s+bookingCode\s*=\s*String\(url\.searchParams\.get\("code"\)\s*\|\|\s*""\)\.trim\(\);\s*if\s*\(\s*!bookingCode\s*\)\s*\{\s*return\s+json\(400,\s*\{\s*ok:\s*false,.*?\}\);\s*\}'
if ($txt -match $patGate) {
  $replacementGate = @'
const url = new URL(req.url);
const bookingCode = String(url.searchParams.get("code") || "").trim();

// If code is missing, try to discover the passenger's latest ACTIVE booking via session.
// If no session, we still return ok=true but signed_in=false (UI can fall back to "new booking" mode).
const ACTIVE_STATUSES = [
  "pending",
  "searching",
  "requested",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip"
];
'@
  $txt = [regex]::Replace($txt, $patGate, $replacementGate, 1)
  Ok "[OK] Replaced bookingCode required-gate with discover-active logic header"
} else {
  Fail "[FAIL] Could not find the bookingCode gate block to replace. Paste the top half of route.ts (GET handler)."
}

# 3) Expand select fields to include fare columns
# Add proposed_fare + passenger_fare_response if missing in the select template literal
if ($txt -match '\.select\(\s*`[\s\S]*booking_code,[\s\S]*status,[\s\S]*created_by_user_id[\s\S]*`\s*\)') {
  if ($txt -notmatch 'proposed_fare' -or $txt -notmatch 'passenger_fare_response') {
    $txt = [regex]::Replace(
      $txt,
      '(?s)(\.select\(\s*`\s*[\s\S]*?created_by_user_id\s*)(\r?\n\s*`\s*\)\s*)',
      '$1' + "`r`n          proposed_fare,`r`n          passenger_fare_response" + '$2',
      1
    )
    Ok "[OK] Added proposed_fare + passenger_fare_response to select()"
  } else {
    Ok "[OK] Fare fields already present in select()"
  }
} else {
  Warn "[WARN] Could not confidently match select() block; continuing without expanding fields."
}

# 4) Replace the single query with branching:
# - if bookingCode: lookup that booking_code (no auth requirement)
# - else: use supabase.auth.getUser() + created_by_user_id + ACTIVE_STATUSES + latest
$patQuery = '(?s)const\s*\{\s*data:\s*b,\s*error\s*\}\s*=\s*await\s+supabase\s*\.from\("bookings"\)\s*\.select\(\s*`[\s\S]*?`\s*\)\s*\.eq\("booking_code",\s*bookingCode\)\s*\.maybeSingle\(\)\s*;'
if ($txt -match $patQuery) {
  $replacementQuery = @'
let b: any = null;
let error: any = null;

if (bookingCode) {
  const res = await supabase
    .from("bookings")
    .select(
      `
          id,
          booking_code,
          status,
          driver_id,
          assigned_driver_id,
          created_at,
          updated_at,
          created_by_user_id,
          proposed_fare,
          passenger_fare_response
          `
    )
    .eq("booking_code", bookingCode)
    .maybeSingle();

  b = res.data;
  error = res.error;
} else {
  // Discover latest active booking for this signed-in passenger.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  if (!user) {
    return json(200, { ok: true, signed_in: false, booking: null });
  }

  const res = await supabase
    .from("bookings")
    .select(
      `
          id,
          booking_code,
          status,
          driver_id,
          assigned_driver_id,
          created_at,
          updated_at,
          created_by_user_id,
          proposed_fare,
          passenger_fare_response
          `
    )
    .eq("created_by_user_id", user.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  b = res.data;
  error = res.error;
}
'@
  $txt = [regex]::Replace($txt, $patQuery, $replacementQuery, 1)
  Ok "[OK] Replaced booking query with (code lookup OR discover-active-by-user) logic"
} else {
  Fail "[FAIL] Could not find the existing booking_code query to replace. Paste the query block from route.ts."
}

# 5) Ensure success response returns booking + signed_in
# Find a success return pattern, and ensure it includes booking
if ($txt -notmatch 'booking:\s*b') {
  # Best effort: after the "if (!b)" not-found handling, we want a return with booking
  # We'll insert if we find 'return json(200' with ok true
  $txt = [regex]::Replace(
    $txt,
    'return\s+json\(\s*200\s*,\s*\{\s*ok\s*:\s*true\s*,',
    'return json(200, { ok: true, signed_in: true, booking: b,',
    1
  )
  Ok "[OK] Ensured response includes signed_in + booking"
}

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Ok ("[OK] Wrote: {0}" -f $target)

Write-Host ""
Write-Host "NEXT: build + deploy. Then /ride should detect ongoing booking even after refresh (no code needed)." -ForegroundColor Cyan
