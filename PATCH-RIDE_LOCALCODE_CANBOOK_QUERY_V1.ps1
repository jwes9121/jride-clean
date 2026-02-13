# PATCH-RIDE_LOCALCODE_CANBOOK_QUERY_V1.ps1
# Purpose:
# - Make /api/public/passenger/can-book calls include town + coords + local_verification_code (query string)
# - This allows "local verification code" to actually influence can-book checks (especially Outside Ifugao)
# Scope: app\ride\page.tsx ONLY

$ErrorActionPreference = "Stop"

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repo "app\ride\page.tsx"

if (!(Test-Path $target)) {
  throw "File not found: $target"
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $target

# 1) Patch refreshCanBook(): replace GET /can-book with query string version
$pattern1 = [regex]::Escape('const r = await getJson("/api/public/passenger/can-book");')
$replacement1 = @'
      const qTown = encodeURIComponent(String(town || "").trim());
      const qLat = encodeURIComponent(String((geoLat ?? pickupLat ?? "")).trim());
      const qLng = encodeURIComponent(String((geoLng ?? pickupLng ?? "")).trim());
      const qCode = hasLocalVerify() ? encodeURIComponent(String(localVerify || "").trim()) : "";
      const url =
        "/api/public/passenger/can-book?town=" + qTown +
        (qLat ? ("&pickup_lat=" + qLat) : "") +
        (qLng ? ("&pickup_lng=" + qLng) : "") +
        (qCode ? ("&local_verification_code=" + qCode) : "");
      const r = await getJson(url);
'@

if ($txt -notmatch [regex]::Escape('async function refreshCanBook()')) {
  throw "Anchor not found: refreshCanBook()"
}
if ($txt -notmatch $pattern1) {
  throw 'Could not find exact line: const r = await getJson("/api/public/passenger/can-book");'
}
$txt = $txt -replace $pattern1, $replacement1

# 2) Patch submit(): replace POST can-book check with GET query string (town + coords + local code)
$pattern2 = [regex]::Escape('const can = await postJson("/api/public/passenger/can-book", {') + '([\s\S]*?)' + [regex]::Escape('});')
if ($txt -notmatch 'const can = await postJson\("/api/public/passenger/can-book",\s*\{') {
  throw "Could not find can-book POST block in submit()"
}

$replacement2 = @'
      const qTown = encodeURIComponent(String(town || "").trim());
      const qLat = encodeURIComponent(String((pickupLat ?? "")).trim());
      const qLng = encodeURIComponent(String((pickupLng ?? "")).trim());
      const qCode = hasLocalVerify() ? encodeURIComponent(String(localVerify || "").trim()) : "";
      const canUrl =
        "/api/public/passenger/can-book?town=" + qTown +
        (qLat ? ("&pickup_lat=" + qLat) : "") +
        (qLng ? ("&pickup_lng=" + qLng) : "") +
        (qCode ? ("&local_verification_code=" + qCode) : "");
      const can = await getJson(canUrl);
'@

# Replace the whole POST block (best-effort, stops at the first matching '});')
$txt = [regex]::Replace(
  $txt,
  'const can = await postJson\("/api/public/passenger/can-book",\s*\{[\s\S]*?\}\);\s*',
  $replacement2,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

# Write back UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Write-Host "[OK] Patched: $target"
Write-Host "[NEXT] Run: npm.cmd run build (web) OR redeploy as needed (but you told me not to touch Vercel right now)."
