param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function Replace-OnceRegex {
  param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][string]$Pattern,
    [Parameter(Mandatory=$true)][string]$Replacement
  )
  $re = New-Object System.Text.RegularExpressions.Regex($Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $re.IsMatch($Text)) { return @{ Text=$Text; Did=$false } }
  return @{ Text=$re.Replace($Text, $Replacement, 1); Did=$true }
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

Info "== PATCH: LiveTrips page-data auto-fix (svcrole if possible + debug/code bypass) V1A / PS5-safe =="
Info "Target: $target"

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("livetrips-page-data.route.ts.bak.AUTOFIX_V1A.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# (A) Inject forceCode param if not present
if ($src -notmatch 'const\s+forceCode\s*=') {
  $inj = Replace-OnceRegex -Text $src `
    -Pattern '(const\s+debug\s*=\s*url\.searchParams\.get\("debug"\)\s*===\s*"1";\s*)' `
    -Replacement ('$1' + "`n    const forceCode = (url.searchParams.get(`"code`") || `"`").trim();`n")
  if ($inj.Did) { $src = $inj.Text; Ok "[OK] Added forceCode param (?code=...)" }
  else { Warn "[WARN] Could not inject forceCode (debug anchor not found). Continuing." }
}

# (B) Detect and replace: const/let X = supabaseAdmin(...)
$varName = $null
$reAssign = New-Object System.Text.RegularExpressions.Regex(
  '(?m)^\s*(const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*supabaseAdmin\s*\((.*?)\)\s*;?\s*$',
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
$m = $reAssign.Match($src)

if ($m.Success) {
  $varName = $m.Groups[2].Value

  # Ensure createClient import exists
  if ($src -notmatch 'createClient\s+from\s+"@supabase/supabase-js"') {
    $ins = Replace-OnceRegex -Text $src `
      -Pattern '(import\s+\{\s*NextResponse\s*\}\s+from\s+"next\/server";\s*)' `
      -Replacement ('${1}import { createClient } from "@supabase/supabase-js";' + "`n")
    if ($ins.Did) { $src = $ins.Text; Ok "[OK] Added createClient import" }
    else { $src = 'import { createClient } from "@supabase/supabase-js";' + "`n" + $src; Ok "[OK] Added createClient import (top fallback)" }
  }

  # Remove supabaseAdmin import if present
  if ($src -match 'from\s+"@/lib/supabaseAdmin"') {
    $src = [System.Text.RegularExpressions.Regex]::Replace(
      $src,
      '(?m)^\s*import\s+\{\s*supabaseAdmin\s*\}\s+from\s+"@\/lib\/supabaseAdmin";\s*$\r?\n?',
      '',
      1
    )
    Ok "[OK] Removed supabaseAdmin import"
  }

  $block = @"
    // AUTO: Force service-role client to avoid RLS silently returning empty trips
    const sbUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      `"`";
    const sbServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      `"`";

    const using_service_role = Boolean(sbUrl && sbServiceKey);

    const $varName = createClient(
      sbUrl,
      (sbServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || `"`"),
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
"@

  $src = $reAssign.Replace($src, $block, 1)
  Ok "[OK] Replaced '$varName = supabaseAdmin(...)' with service-role createClient(...)"
} else {
  Warn "[WARN] No 'const/let X = supabaseAdmin(...)' assignment found. Will NOT force client; will still inject ?code bypass using detected client var."
}

# (C) Determine client var used for bookings query (fallback)
if (-not $varName) {
  $reFrom = New-Object System.Text.RegularExpressions.Regex('([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*from\s*\(\s*["'']bookings["'']\s*\)', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $m2 = $reFrom.Match($src)
  if ($m2.Success) { $varName = $m2.Groups[1].Value; Ok "[OK] Detected client var for .from('bookings'): $varName" }
}

if (-not $varName) {
  $varName = "supabase"
  Warn "[WARN] Could not detect client var. Assuming 'supabase'."
}

# (D) Inject ?code bypass (before RPC if possible; else before first return ok)
$codeBypass = @"
    // AUTO: ?code= bypass to fetch a single booking for diagnosis
    if (forceCode) {
      const probe = await $varName
        .from("bookings")
        .select("*")
        .eq("booking_code", forceCode)
        .limit(1);

      const row = (probe as any)?.data?.[0] ?? null;

      return ok({
        trips: row ? [row] : [],
        __debug: debug ? {
          injected_active_statuses: ACTIVE_STATUSES,
          using_service_role: (typeof using_service_role !== "undefined") ? using_service_role : null,
          has_SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
          has_SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          code: forceCode,
          probe_error: (probe as any)?.error ? (((probe as any).error as any)?.message || String((probe as any).error)) : null
        } : undefined
      });
    }

"@

$inj1 = Replace-OnceRegex -Text $src `
  -Pattern "(await\s+$varName\s*\.rpc\s*\()" `
  -Replacement ($codeBypass + '$1')

if ($inj1.Did) {
  $src = $inj1.Text
  Ok "[OK] Injected ?code bypass before RPC"
} else {
  $inj2 = Replace-OnceRegex -Text $src `
    -Pattern '(return\s+ok\s*\()' `
    -Replacement ($codeBypass + '$1')
  if ($inj2.Did) {
    $src = $inj2.Text
    Ok "[OK] Injected ?code bypass before first return ok(...)"
  } else {
    Warn "[WARN] Could not inject ?code bypass (no RPC/return ok anchor found)."
  }
}

# (E) Expand simple __debug shape if present (best-effort)
$reDbg = New-Object System.Text.RegularExpressions.Regex('__debug\s*:\s*debug\s*\?\s*\{\s*injected_active_statuses\s*:\s*ACTIVE_STATUSES\s*\}\s*:\s*undefined', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($reDbg.IsMatch($src)) {
  $src = $reDbg.Replace(
    $src,
    '__debug: debug ? { injected_active_statuses: ACTIVE_STATUSES, using_service_role: (typeof using_service_role !== "undefined") ? using_service_role : null, has_SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL), has_SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) } : undefined',
    1
  )
  Ok "[OK] Expanded __debug (simple shape) to include env flags"
}

# Write back UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src, $utf8NoBom)
Ok "[OK] Wrote patched file (UTF-8 no BOM)"

Info ""
Info "NEXT: redeploy and open:"
Info "  https://app.jride.net/api/admin/livetrips/page-data?debug=1&code=JR-UI-20260213234952-9212"
Info "  https://app.jride.net/api/admin/livetrips/page-data?debug=1"
