param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: passenger booking by code uses Supabase SERVICE ROLE (V1 / PS5-safe) ==" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"
if (-not (Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("public-passenger-booking.route.ts.bak.SVCROLE_BY_CODE_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $target -Raw

# 1) Ensure import createClient from supabase-js exists
if ($txt -notmatch 'from\s+"@supabase/supabase-js"') {
  # Insert after NextRequest/NextResponse import if present
  if ($txt -match 'import\s+\{\s*NextRequest\s*,\s*NextResponse\s*\}\s+from\s+"next/server";') {
    $txt = [regex]::Replace(
      $txt,
      '(import\s+\{\s*NextRequest\s*,\s*NextResponse\s*\}\s+from\s+"next/server";\s*)',
      '$1' + "`r`nimport { createClient as createAdminClient } from ""@supabase/supabase-js"";`r`n",
      1
    )
    Ok "[OK] Added supabase-js admin client import"
  } else {
    $txt = 'import { createClient as createAdminClient } from "@supabase/supabase-js";' + "`r`n" + $txt
    Ok "[OK] Added supabase-js admin client import at top"
  }
} else {
  Ok "[OK] supabase-js import already present"
}

# 2) Add helper to create service-role client (server-only)
if ($txt -notmatch 'function\s+getServiceRoleClient\(') {
  $helper = @'
function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
'@

  # Insert after createClient import line
  if ($txt -match 'import\s+\{\s*createClient\s*\}\s+from\s+"@/utils/supabase/server";') {
    $txt = [regex]::Replace(
      $txt,
      '(import\s+\{\s*createClient\s*\}\s+from\s+"@/utils/supabase/server";\s*)',
      '$1' + "`r`n" + $helper + "`r`n",
      1
    )
    Ok "[OK] Inserted getServiceRoleClient() helper"
  } else {
    # Fallback: insert after first import block
    $txt = $helper + "`r`n" + $txt
    Ok "[OK] Inserted getServiceRoleClient() helper at top (fallback)"
  }
}

# 3) Expand SELECT to include proposed_fare + passenger_fare_response (needed for fare popup)
if ($txt -notmatch 'proposed_fare') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)(created_by_user_id\s*)(\r?\n\s*`)',
    '$1' + "`r`n          proposed_fare,`r`n          passenger_fare_response" + '$2',
    1
  )
  Ok "[OK] Added proposed_fare + passenger_fare_response to select list"
} else {
  Ok "[OK] Fare fields already in select list"
}

# 4) Replace the bookingCode lookup to use service role when code is provided
# We’ll look for: .eq("booking_code", bookingCode).maybeSingle();
$pat = '(?s)const\s+\{\s*data:\s*b,\s*error\s*\}\s*=\s*await\s+supabase\s*\.from\("bookings"\)\s*\.select\([\s\S]*?\)\s*\.eq\("booking_code",\s*bookingCode\)\s*\.maybeSingle\(\)\s*;'
if ($txt -match $pat) {
  $replacement = @'
const svc = getServiceRoleClient();
const clientForCode = svc ?? supabase;

const { data: b, error } = await clientForCode
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
'@
  $txt = [regex]::Replace($txt, $pat, $replacement, 1)
  Ok "[OK] Patched booking lookup to use service role (if available)"
} else {
  Warn "[WARN] Could not match exact booking_code query block. Applying a safer targeted insert near .eq(""booking_code"", bookingCode)..."

  if ($txt -match '\.eq\("booking_code",\s*bookingCode\)\s*\.maybeSingle\(\)') {
    # Insert client selection just before the query start: "const { data: b, error } = await supabase"
    $txt = [regex]::Replace(
      $txt,
      'const\s+\{\s*data:\s*b,\s*error\s*\}\s*=\s*await\s+supabase',
      'const svc = getServiceRoleClient();' + "`r`n" +
      'const clientForCode = svc ?? supabase;' + "`r`n`r`n" +
      'const { data: b, error } = await clientForCode',
      1
    )
    Ok "[OK] Inserted service-role client selection (fallback)"
  } else {
    Fail "[FAIL] Could not locate booking_code query to patch. Paste the booking_code query block from route.ts."
  }
}

# 5) Ensure response marks signed_in properly for code-based lookup
# We don’t want signed_in false if code lookup works (even if no session cookie)
if ($txt -match 'signed_in:\s*false' ) {
  $txt = [regex]::Replace($txt, 'signed_in:\s*false', 'signed_in: true', 1)
  Ok "[OK] Adjusted first signed_in:false to true (code lookup path)"
} else {
  Warn "[WARN] Did not find signed_in:false to replace (may already be handled)."
}

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Ok ("[OK] Wrote: {0}" -f $target)

Write-Host ""
Write-Host "IMPORTANT: Add SUPABASE_SERVICE_ROLE_KEY to Vercel (Production) before testing." -ForegroundColor Yellow
Write-Host "Then retest: https://app.jride.net/api/public/passenger/booking?code=JR-UI-..." -ForegroundColor Cyan
