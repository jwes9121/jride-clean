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
  $out = $re.Replace($Text, $Replacement, 1)
  return @{ Text=$out; Did=$true }
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

Info "== PATCH: LiveTrips page-data force SUPABASE_SERVICE_ROLE_KEY (V1.1 / PS5-safe) =="
Info "Target: $target"

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("livetrips-page-data.route.ts.bak.FORCE_SVCROLE_V1_1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# 1) Ensure createClient import exists
if ($src -notmatch 'createClient\s+from\s+"@supabase/supabase-js"') {
  $ins = Replace-OnceRegex -Text $src `
    -Pattern '(import\s+\{\s*NextResponse\s*\}\s+from\s+"next\/server";\s*)' `
    -Replacement "`${1}import { createClient } from `"`@supabase/supabase-js`"`;`n"
  if ($ins.Did) {
    $src = $ins.Text
    Ok "[OK] Added createClient import"
  } else {
    # fallback: add at very top
    $src = "import { createClient } from `"`@supabase/supabase-js`"`;`n" + $src
    Ok "[OK] Added createClient import (top of file fallback)"
  }
}

# 2) Remove supabaseAdmin import if present (safe)
if ($src -match 'from\s+"@\/lib\/supabaseAdmin"') {
  $src = [System.Text.RegularExpressions.Regex]::Replace(
    $src,
    '(?m)^\s*import\s+\{\s*supabaseAdmin\s*\}\s+from\s+"@\/lib\/supabaseAdmin";\s*$\r?\n?',
    '',
    1
  )
  Ok "[OK] Removed supabaseAdmin import"
}

# 3) Replace `const supabase = supabaseAdmin();` with forced service-role client block
$block = @'
  // Force service-role client here to avoid RLS silently returning empty trips in production.
  const sbUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const sbServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  const using_service_role = Boolean(sbUrl && sbServiceKey);

  const supabase = createClient(
    sbUrl,
    (sbServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || ""),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
'@

$rep = Replace-OnceRegex -Text $src `
  -Pattern '(?m)^\s*const\s+supabase\s*=\s*supabaseAdmin\(\)\s*;\s*$' `
  -Replacement $block

if (-not $rep.Did) {
  Fail "[FAIL] Could not find anchor line: const supabase = supabaseAdmin();"
}
$src = $rep.Text
Ok "[OK] Replaced supabaseAdmin() with forced createClient() block"

# 4) Inject debug flags near injected_active_statuses (only if not already there)
if ($src -match 'injected_active_statuses' -and $src -notmatch 'using_service_role') {
  $inject = @'
injected_active_statuses: ACTIVE_STATUSES,
        using_service_role,
        has_SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
        has_SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
'@
  $src = [System.Text.RegularExpressions.Regex]::Replace(
    $src,
    'injected_active_statuses\s*:\s*ACTIVE_STATUSES\s*,',
    $inject,
    1
  )
  Ok "[OK] Added debug: using_service_role + env presence flags"
}

# 5) After activeRows query, append safe debug counts (only if not already there)
if ($src -notmatch 'active_rows_count') {
  $markerPattern = '(const\s+\{\s*data:\s*activeRows,\s*error:\s*activeErr\s*\}\s*=\s*await\s*supabase[\s\S]*?\.limit\(\s*250\s*\);\s*)'
  $addon = @'
$1

      // Debug visibility (safe)
      if (debug) {
        (debug as any).active_rows_count = Array.isArray(activeRows) ? activeRows.length : 0;
        (debug as any).active_error = activeErr ? ((activeErr as any)?.message || String(activeErr)) : null;
      }

'@
  $tmp = Replace-OnceRegex -Text $src -Pattern $markerPattern -Replacement $addon
  if ($tmp.Did) {
    $src = $tmp.Text
    Ok "[OK] Added debug: active_rows_count + active_error"
  } else {
    Warn "[WARN] Could not locate activeRows query block to append debug counts (non-fatal)."
  }
}

# Write back UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src, $utf8NoBom)
Ok "[OK] Wrote patched file (UTF-8 no BOM)"
