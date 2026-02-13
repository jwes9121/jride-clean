# PATCH-JRIDE_FIX_ADMIN_DRIVER_LOCATIONS_BUILD_AND_FILTER.ps1
# Fixes:
#  - creates/repairs lib\supabaseAdmin.ts (admin client factory)
#  - fixes app\api\admin\driver_locations\route.ts import + calls supabaseAdmin()
#  - removes any hard-coded town filter and supports optional ?town=
# NOTE: UTF-8 no BOM recommended when saving.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path

$targets = @(
  (Join-Path $root "lib\supabaseAdmin.ts"),
  (Join-Path $root "app\api\admin\driver_locations\route.ts")
)

foreach($p in $targets){
  $dir = Split-Path $p -Parent
  if(!(Test-Path $dir)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

# --- 1) Ensure lib\supabaseAdmin.ts exists (admin client factory)
$adminLib = Join-Path $root "lib\supabaseAdmin.ts"
if(Test-Path $adminLib){
  Copy-Item $adminLib ($adminLib + ".bak." + (Get-Date -Format "yyyyMMdd_HHmmss")) -Force
}

@'
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase admin client (service role).
 * Requires env vars (set in Vercel + local):
 * - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY (NEVER expose to client)
 */
export function supabaseAdmin(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "jride-admin-api" } },
  });
}
'@ | Set-Content -Path $adminLib -Encoding UTF8

Write-Host "[OK] Wrote lib\supabaseAdmin.ts"

# --- 2) Patch app\api\admin\driver_locations\route.ts
$route = Join-Path $root "app\api\admin\driver_locations\route.ts"
if(!(Test-Path $route)){
  Fail "Missing file: $route"
}
Copy-Item $route ($route + ".bak." + (Get-Date -Format "yyyyMMdd_HHmmss")) -Force

$txt = Get-Content $route -Raw

# Normalize import to alias path
$txt = $txt -replace "from\s+['""]\.\./\.\./\.\./lib/supabaseAdmin['""]", "from `"@/lib/supabaseAdmin`""
$txt = $txt -replace "from\s+['""]\@\s*/lib/supabaseAdmin['""]", "from `"@/lib/supabaseAdmin`""
$txt = $txt -replace "from\s+['""]\@\s*\/lib\/supabaseAdmin['""]", "from `"@/lib/supabaseAdmin`""

# If it imports supabaseAdmin via relative path, force it.
if($txt -notmatch "supabaseAdmin"){
  # not expected, but keep safe
}

# Ensure route creates a client instance
# Replace any 'let q = supabaseAdmin.from(' or 'supabaseAdmin.from(' usage
$txt = $txt -replace "(\b)supabaseAdmin\s*\.\s*from\s*\(", "`$1supabaseAdmin().from("
# If file assigns supabaseAdmin to variable expecting client:
# Try to introduce 'const supabase = supabaseAdmin();' near top if missing.
if($txt -notmatch "const\s+supabase\s*=\s*supabaseAdmin\(\)"){
  # Insert after the first line that contains supabaseAdmin import
  $lines = $txt -split "`n"
  $out = New-Object System.Collections.Generic.List[string]
  $inserted = $false
  foreach($line in $lines){
    $out.Add($line)
    if(-not $inserted -and $line -match "from\s+[`"']@/lib/supabaseAdmin[`"']"){
      $out.Add("")
      $out.Add("const supabase = supabaseAdmin();")
      $out.Add("")
      $inserted = $true
    }
  }
  $txt = ($out -join "`n")
}

# Make query use 'supabase' variable if it exists and file still references supabaseAdmin() directly in a chain
# This is optional; supabaseAdmin().from(...) is fine, but we prefer 'supabase.from(...)'
$txt = $txt -replace "\bsupabaseAdmin\(\)\.from\(", "supabase.from("

# Add optional town filter (only if file has a query block and does NOT already handle town param)
if($txt -notmatch "searchParams" -and $txt -match "new URL\("){
  # leave it
}

# Best-effort: add town filter block if not present
if($txt -notmatch "const\s+town\s*="){
  # Try to inject into GET handler: after it reads URL/searchParams
  $txt = $txt -replace "(const\s+url\s*=\s*new\s+URL\([^\)]*\);\s*)", "`$1`n    const town = url.searchParams.get(`"town`");`n"
}
if($txt -notmatch "q\s*=\s*q\.ilike\(" -and $txt -match "\.from\(\s*[`"']dispatch_driver_locations_view[`"']\s*\)"){
  # If it already builds q, inject town filter after select/order/limit (best-effort)
  $txt = $txt -replace "(\.limit\([0-9]+\);\s*)", "`$1`n    if (town) { q = q.ilike(`"town`", town); }`n"
}

Set-Content -Path $route -Value $txt -Encoding UTF8
Write-Host "[OK] Patched app\api\admin\driver_locations\route.ts"

Write-Host ""
Write-Host "[NEXT] Run a clean build:"
Write-Host "  npm.cmd run build"
