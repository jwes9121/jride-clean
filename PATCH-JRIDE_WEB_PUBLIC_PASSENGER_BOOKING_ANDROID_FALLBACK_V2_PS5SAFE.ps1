param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE WEB PUBLIC PASSENGER BOOKING ANDROID FALLBACK V2 (PS5-safe) =="

$routePath = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"
if (!(Test-Path $routePath)) {
  throw "route.ts not found: $routePath"
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $routePath (Join-Path $backupDir ("route.ts.bak.PUBLIC_PASSENGER_BOOKING_ANDROID_FALLBACK_V2.{0}" -f $timestamp)) -Force
Write-Host "[OK] Backup created"

$content = Get-Content -LiteralPath $routePath -Raw

# ------------------------------------------------------------
# 1) Expand BookReq type with Android aliases
# ------------------------------------------------------------
$typePattern = '(?s)type\s+BookReq\s*=\s*\{.*?service\?\s*:\s*string\s*\|\s*null;\s*\};'

$typeReplacement = @'
type BookReq = {
  passenger_name?: string | null;
  full_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;
  pickup_label?: string | null;
  dropoff_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  created_by_user_id?: string | null;
  user_id?: string | null;
  phone?: string | null;
  fees_acknowledged?: boolean | null;
  local_verification_code?: string | null;

  service?: string | null;
};
'@

$typeUpdated = [regex]::Replace($content, $typePattern, $typeReplacement, 1)
if ($typeUpdated -eq $content) {
  throw "BookReq block not replaced"
}
$content = $typeUpdated
Write-Host "[OK] Expanded BookReq type"

# ------------------------------------------------------------
# 2) Add pickup_label/dropoff_label normalization
# ------------------------------------------------------------
$normalizeAnchor = @'
      if (_b.pickup_lat == null && _b.pickupLat != null) _b.pickup_lat = _b.pickupLat;
      if (_b.pickup_lng == null && _b.pickupLng != null) _b.pickup_lng = _b.pickupLng;
      if (_b.dropoff_lat == null && _b.dropoffLat != null) _b.dropoff_lat = _b.dropoffLat;
      if (_b.dropoff_lng == null && _b.dropoffLng != null) _b.dropoff_lng = _b.dropoffLng;
'@

$normalizeReplacement = @'
      if (_b.pickup_lat == null && _b.pickupLat != null) _b.pickup_lat = _b.pickupLat;
      if (_b.pickup_lng == null && _b.pickupLng != null) _b.pickup_lng = _b.pickupLng;
      if (_b.dropoff_lat == null && _b.dropoffLat != null) _b.dropoff_lat = _b.dropoffLat;
      if (_b.dropoff_lng == null && _b.dropoffLng != null) _b.dropoff_lng = _b.dropoffLng;

      if ((_b.from_label == null || String(_b.from_label).trim() === "") && _b.pickup_label != null) {
        _b.from_label = _b.pickup_label;
      }
      if ((_b.to_label == null || String(_b.to_label).trim() === "") && _b.dropoff_label != null) {
        _b.to_label = _b.dropoff_label;
      }
'@

if ($content.Contains($normalizeAnchor)) {
  $content = $content.Replace($normalizeAnchor, $normalizeReplacement)
  Write-Host "[OK] Added pickup_label/dropoff_label normalization"
} else {
  throw "Normalization anchor not found"
}

# ------------------------------------------------------------
# 3) Replace strict auth block with Android fallback
# ------------------------------------------------------------
$authOld = @'
  const uv = await frGetUserAndVerified(supabase as any);
  const user = uv.user;
  const isVerified = uv.verified;

  // Always attach creator (bookings has created_by_user_id in your schema)
  // If insert fails due to column mismatch, fallback logic already exists below.
  const createdByUserId = user?.id ? String(user.id) : null;

  if (!createdByUserId) {
    return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });
  }

  // TAKEOUT REQUIRES VERIFIED (always, per business rule)
  if (isTakeout && !isVerified) {
    return NextResponse.json(
      { ok: false, code: "TAKEOUT_REQUIRES_VERIFIED", message: "Verify your account to order takeout during pilot." },
      { status: 403 }
    );
  }
'@

$authNew = @'
  const uv = await frGetUserAndVerified(supabase as any);
  const user = uv.user;
  let isVerified = uv.verified;

  const bodyAny: any = body as any;
  const createdByUserId =
    (user?.id ? String(user.id) : "") ||
    String(bodyAny?.created_by_user_id || bodyAny?.user_id || "").trim() ||
    null;

  const usingAndroidIdentityFallback =
    !user?.id &&
    !!String(bodyAny?.created_by_user_id || bodyAny?.user_id || "").trim();

  if (usingAndroidIdentityFallback) {
    isVerified = false;
  }

  if (!createdByUserId) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHED", message: "Not signed in and no created_by_user_id fallback was provided." },
      { status: 401 }
    );
  }

  // TAKEOUT REQUIRES VERIFIED (always, per business rule)
  if (isTakeout && !isVerified) {
    return NextResponse.json(
      { ok: false, code: "TAKEOUT_REQUIRES_VERIFIED", message: "Verify your account to order takeout during pilot." },
      { status: 403 }
    );
  }
'@

if ($content.Contains($authOld)) {
  $content = $content.Replace($authOld, $authNew)
  Write-Host "[OK] Added Android created_by_user_id fallback"
} else {
  throw "Auth block not found"
}

# ------------------------------------------------------------
# 4) Write file
# ------------------------------------------------------------
Set-Content -LiteralPath $routePath -Value $content -Encoding UTF8
Write-Host "[OK] Wrote route.ts"
Write-Host ""
Write-Host "PATCH COMPLETE"
Write-Host "Modified:"
Write-Host " - $routePath"