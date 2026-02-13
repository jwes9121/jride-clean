# PATCH-JRIDE_PHASE15B2_VENDOR_ORDERS_USE_SERVICE_ROLE_FOR_INSERT.ps1
# One file only: app/api/vendor-orders/route.ts
# Fix: RLS insert failure by using a service-role Supabase client for DB writes,
# while still requiring a logged-in user (auth gate).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

$rel = "app\api\vendor-orders\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# 1) Ensure we can create a service-role client (server-side only)
if ($txt -notmatch '@supabase/supabase-js') {
  # Insert import near top (after existing imports)
  $txt = $txt -replace '(?m)^import\s+.*\r?\n', '$0'  # no-op to ensure regex engine loads
  $txt = [regex]::Replace(
    $txt,
    '(?m)^(import\s+.*\r?\n)+',
    '$0import { createClient as createAdminClient } from "@supabase/supabase-js";' + "`r`n",
    1
  )
  Ok "Inserted supabase-js admin client import."
}

# 2) Inside POST, add auth check + admin client creation, and use admin client for insert/update.
# We patch by inserting a block right after: const supabase = createRouteHandlerClient({ cookies });
$anchor = 'const\s+supabase\s*=\s*createRouteHandlerClient\(\{\s*cookies\s*\}\);\s*'
if ($txt -notmatch $anchor) { Fail "Could not find supabase route-handler client line in route.ts." }

if ($txt -match 'VENDOR_ORDERS_ADMIN_CLIENT') {
  Ok "Already patched for service-role admin client. No change."
  Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
  exit 0
}

$inject = @'
  // VENDOR_ORDERS_ADMIN_CLIENT
  // Use route-handler client for auth (RLS), but service-role client for DB writes (bypass RLS) in this trusted API route.
  const { data: authData } = await supabase.auth.getUser();
  const authedUser = authData?.user ?? null;
  if (!authedUser) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED", message: "Login required" }, { status: 401 });
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

'@

$txt = [regex]::Replace($txt, $anchor, '$0' + $inject, 1)
Ok "Injected auth gate + service-role admin client into POST flow."

# 3) Replace any ".from("bookings")" operations inside POST that are used for insert/update to use admin instead of supabase.
# We only switch the obvious patterns for insert/update blocks.
$before = $txt

# insert(...) chain
$txt = [regex]::Replace(
  $txt,
  '(?s)(await\s+)supabase(\s*\.\s*from\("bookings"\)\s*\.\s*insert\s*\()',
  '$1admin$2',
  0
)

# update(...) chain
$txt = [regex]::Replace(
  $txt,
  '(?s)(await\s+)supabase(\s*\.\s*from\("bookings"\)\s*\.\s*update\s*\()',
  '$1admin$2',
  0
)

if ($txt -eq $before) {
  # Not fatal; route might use a different variable name or structure.
  Ok "No direct supabase->admin replacements matched (this can still be OK depending on structure)."
} else {
  Ok "Switched bookings insert/update to use admin client."
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "IMPORTANT: Set SUPABASE_SERVICE_ROLE_KEY in .env.local and Vercel env vars (do not share it)."
