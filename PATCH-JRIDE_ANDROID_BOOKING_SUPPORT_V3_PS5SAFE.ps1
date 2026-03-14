param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference="Stop"

Write-Host "== JRIDE ANDROID BOOKING SUPPORT V3 (PS5 SAFE) =="

$route = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"

if (!(Test-Path $route)) {
    throw "route.ts not found: $route"
}

# ------------------------------------------------------------
# backup
# ------------------------------------------------------------

$backupDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $route (Join-Path $backupDir "route.ts.ANDROID_BOOKING_SUPPORT_V3.$ts.bak")

Write-Host "[OK] Backup created"

$content = Get-Content $route -Raw

# ------------------------------------------------------------
# 1) ADD ANDROID LABEL NORMALIZATION
# ------------------------------------------------------------

$aliasBlock = @"

      // ANDROID LABEL ALIAS SUPPORT
      if ((_b.from_label == null || String(_b.from_label).trim() === "") && _b.pickup_label != null) {
        _b.from_label = _b.pickup_label;
      }

      if ((_b.to_label == null || String(_b.to_label).trim() === "") && _b.dropoff_label != null) {
        _b.to_label = _b.dropoff_label;
      }

"@

if ($content -notmatch "pickup_label") {

    $content = $content -replace `
    "if \(_b\.dropoff_lng == null && _b\.dropoffLng != null\) _b\.dropoff_lng = _b\.dropoffLng;",
    "if (_b.dropoff_lng == null && _b.dropoffLng != null) _b.dropoff_lng = _b.dropoffLng;$aliasBlock"

    Write-Host "[OK] Android pickup/dropoff alias inserted"

} else {

    Write-Host "[SKIP] Android alias already present"

}

# ------------------------------------------------------------
# 2) ANDROID USER ID FALLBACK
# ------------------------------------------------------------

if ($content -match "const createdByUserId = user\?\.id") {

$old = @"
const createdByUserId = user?.id ? String(user.id) : null;

  if (!createdByUserId) {
    return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });
  }
"@

$new = @"
let createdByUserId = user?.id ? String(user.id) : null;

  if (!createdByUserId) {
    const bodyAny:any = body as any
    const androidId = String(bodyAny?.created_by_user_id || bodyAny?.user_id || "").trim()

    if (androidId) {
      createdByUserId = androidId
    }
  }

  if (!createdByUserId) {
    return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });
  }
"@

$content = $content.Replace($old,$new)

Write-Host "[OK] Android identity fallback added"

} else {

Write-Host "[SKIP] Auth block already modified"

}

# ------------------------------------------------------------
# write file
# ------------------------------------------------------------

Set-Content -Path $route -Value $content -Encoding UTF8

Write-Host "[OK] route.ts updated"
Write-Host ""
Write-Host "PATCH COMPLETE"