# PATCH-JRIDE_VENDOR_ORDERS_UI_SKIP_EMPTY_VENDORID_V2.ps1
# Fix vendor-orders page: don't call API/poll until vendorId is present.
# Works regardless of how fetch URL is constructed.
# UTF-8 no BOM + backup

$ErrorActionPreference="Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

$f = Join-Path $root "app\vendor-orders\page.tsx"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

Copy-Item -Force $f "$f.bak.$ts"
Ok "Backup: $f.bak.$ts"

$txt = [System.IO.File]::ReadAllText($f)

# 1) Insert guard inside loadOrders() right after setIsLoading(true) / setError(null)
$patLoad = '(?s)(const\s+loadOrders\s*=\s*async\s*\(\)\s*=>\s*\{\s*try\s*\{\s*setIsLoading\(\s*true\s*\)\s*;\s*setError\(\s*null\s*\)\s*;\s*)'
if ($txt -notmatch $patLoad) {
  Fail "Could not locate loadOrders() header with setIsLoading(true) + setError(null) in $f. Paste the loadOrders() function."
}

$guard = @'
      const v = String(vendorId || "").trim();
      if (!v) {
        // Do not call API until vendorId is loaded from query/localStorage
        setError("vendor_id_required (pilot mode)");
        setIsLoading(false);
        return;
      }

'@

$txt2 = [regex]::Replace($txt, $patLoad, ('$1' + $guard), 1)
Ok "Inserted guard inside loadOrders()"

# 2) Replace polling useEffect([]) with useEffect([vendorId]) and skip when empty
# We match any useEffect that sets an interval of 10000 and calls loadOrders() before it.
$patEffect = '(?s)useEffect\(\s*\(\)\s*=>\s*\{\s*loadOrders\(\)\.catch\(\(\)\s*=>\s*undefined\);\s*const\s+t\s*=\s*setInterval\(\(\)\s*=>\s*\{\s*.*?loadOrders\(\)\.catch\(\(\)\s*=>\s*undefined\);\s*\}\s*,\s*10000\s*\);\s*return\s*\(\)\s*=>\s*clearInterval\(t\);\s*//\s*eslint-disable-next-line[\s\S]*?\}\s*,\s*\[\s*\]\s*\);'
if ($txt2 -notmatch $patEffect) {
  Fail "Could not locate the polling useEffect() block in $f. Paste the polling useEffect section."
}

$replEffect = @'
useEffect(() => {
  const v = String(vendorId || "").trim();
  if (!v) return;

  loadOrders().catch(() => undefined);

  const t = setInterval(() => {
    loadOrders().catch(() => undefined);
  }, 10000);

  return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [vendorId]);
'@

$txt3 = [regex]::Replace($txt2, $patEffect, $replEffect, 1)
Ok "Replaced polling useEffect() to depend on vendorId"

[System.IO.File]::WriteAllText($f, $txt3, $utf8NoBom)
Ok "Patched: $f"
Ok "Vendor-orders UI will no longer call API/poll with empty vendorId."
