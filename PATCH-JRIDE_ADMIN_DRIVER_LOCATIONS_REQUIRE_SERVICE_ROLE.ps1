# PATCH-JRIDE_ADMIN_DRIVER_LOCATIONS_REQUIRE_SERVICE_ROLE.ps1
# Forces /api/admin/driver_locations to use Service Role only (no ANON fallback)
# This avoids RLS silently filtering your online drivers.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function Find-RepoRoot([string]$start) {
  $cur = Resolve-Path $start
  while ($true) {
    if (Test-Path (Join-Path $cur "package.json")) { return $cur }
    $parent = Split-Path $cur -Parent
    if ($parent -eq $cur) { break }
    $cur = $parent
  }
  return $null
}

$root = Find-RepoRoot (Get-Location).Path
if (-not $root) { Fail "Could not find repo root (package.json). Run inside your repo." }

$target = Join-Path $root "app\api\admin\driver_locations\route.ts"
if (-not (Test-Path $target)) { Fail "Not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content -LiteralPath $target -Raw

# Replace the entire supabase() helper with a strict service-role version.
$pattern = '(?s)function\s+supabase\(\)\s*\{.*?\n\}'
if ($txt -notmatch $pattern) {
  Fail "Could not locate supabase() function block. Paste route.ts so I can patch safely."
}

$replacement = @'
function supabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  // IMPORTANT: admin API must use service role to bypass RLS
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) {
    throw new Error("Supabase env missing: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
'@

$txt2 = [Regex]::Replace($txt, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)

# Optional: make response include count (helps debug quickly in the browser)
$txt2 = $txt2.Replace(
  'return NextResponse.json(',
  'return NextResponse.json('
)

Set-Content -LiteralPath $target -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $target" -ForegroundColor Green

Write-Host ""
Write-Host "NEXT STEP:" -ForegroundColor Cyan
Write-Host "1) Set Vercel env: SUPABASE_SERVICE_ROLE_KEY (production)"
Write-Host "2) Redeploy"
Write-Host "3) Open: https://app.jride.net/api/admin/driver_locations and confirm count matches Supabase"
