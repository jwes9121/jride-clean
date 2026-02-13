# FIX-WalletTx-BAD_ID-AllowAnyUUID.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path $root $rel
if (!(Test-Path $path)) { Fail "Missing file: $rel (run this from repo root)" }

$txt = Get-Content -Raw -Path $path

# Must contain BAD_ID message (your API returns this exact message)
if ($txt -notmatch "BAD_ID" -or $txt -notmatch "Missing/invalid id \(uuid\)") {
  Fail "Could not find the BAD_ID id-validation block in $rel. (No 'BAD_ID' + 'Missing/invalid id (uuid)' found.)"
}

# 1) Ensure a generic UUID regex exists (accepts any UUID version)
$uuidDecl = "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`r`n"
if ($txt -notmatch "(?m)^\s*const\s+UUID_RE\s*=\s*/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/i\s*;\s*$") {
  $rxImports = '(?ms)\A((?:\s*import[^\r\n]*\r?\n)+)'
  if ($txt -match $rxImports) {
    $txt = [regex]::Replace($txt, $rxImports, ('$1' + $uuidDecl))
  } else {
    $txt = $uuidDecl + $txt
  }
}

# 2) Replace the BAD_ID validation block with UUID_RE-based check
$rxBadIdIf = '(?ms)^\s*if\s*\(\s*[^)]*\)\s*\{\s*return\s+bad\(\s*["'']Missing\/invalid id \(uuid\)["'']\s*,\s*["'']BAD_ID["''][^;]*;\s*\}\s*'
if ($txt -notmatch $rxBadIdIf) {
  # Some code uses single-line if without braces
  $rxBadIdIf2 = '(?m)^\s*if\s*\(\s*[^)]*\)\s*return\s+bad\(\s*["'']Missing\/invalid id \(uuid\)["'']\s*,\s*["'']BAD_ID["''][^;]*;\s*$'
  if ($txt -notmatch $rxBadIdIf2) {
    Fail "Found BAD_ID message but could not locate the exact 'if (...) return bad(...)' block to replace. This script refuses to guess."
  }

  $replacement = 'if (!id || !UUID_RE.test(String(id))) return bad("Missing/invalid id (uuid)", "BAD_ID", 400);'
  $txt = [regex]::Replace($txt, $rxBadIdIf2, $replacement)
} else {
  $replacement = @'
if (!id || !UUID_RE.test(String(id))) {
  return bad("Missing/invalid id (uuid)", "BAD_ID", 400);
}
'@
  $txt = [regex]::Replace($txt, $rxBadIdIf, $replacement)
}

Set-Content -Path $path -Value $txt -Encoding UTF8
Write-Host ("[OK] Patched {0} - BAD_ID now accepts any UUID (including 1111... vendor_id)." -f $rel) -ForegroundColor Green
Write-Host "[NEXT] Run: npm run build" -ForegroundColor Cyan
