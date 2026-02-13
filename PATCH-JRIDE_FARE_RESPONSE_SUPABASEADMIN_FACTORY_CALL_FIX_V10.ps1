# PATCH-JRIDE_FARE_RESPONSE_SUPABASEADMIN_FACTORY_CALL_FIX_V10.ps1
# Fix: supabaseAdmin is a factory () => SupabaseClient, so it must be called before .from()
# Action:
# - Insert: const sa = supabaseAdmin();
# - Replace supabaseAdmin.<method> with sa.<method> in this route

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$ROOT = (Get-Location).Path
$Target = Join-Path $ROOT 'app\api\rides\fare-response\route.ts'
if (!(Test-Path $Target)) { Fail "Missing file: $Target" }

# Backup
$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
Copy-Item $Target ($Target + ".bak." + $ts) -Force
Ok "[OK] Backup: $Target.bak.$ts"

$txt = Get-Content -LiteralPath $Target -Raw
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# If already has sa declaration, just replace usage if needed
if ($txt -notmatch '(?m)^\s*const\s+sa\s*=\s*supabaseAdmin\(\)\s*;\s*$') {

  # Anchor: after the supabaseAdmin import line
  $reImport = [regex]::new('(?m)^\s*import\s*\{\s*supabaseAdmin\s*\}\s*from\s*["'']@/lib/supabaseAdmin["'']\s*;\s*$')
  if (-not $reImport.IsMatch($txt)) {
    Fail "Anchor not found: import { supabaseAdmin } from '@/lib/supabaseAdmin';"
  }

  $txt = $reImport.Replace($txt, {
    param($m)
    return $m.Value + "`r`n`r`n" + "const sa = supabaseAdmin();"
  }, 1)

  Ok "[OK] Inserted const sa = supabaseAdmin();"
} else {
  Info "[SKIP] sa factory call already present"
}

# Replace supabaseAdmin.<something> with sa.<something> (word-boundary safe)
$reUse = [regex]::new('(?<![A-Za-z0-9_])supabaseAdmin\s*\.', [System.Text.RegularExpressions.RegexOptions]::None)
if ($reUse.IsMatch($txt)) {
  $txt = $reUse.Replace($txt, 'sa.', 1000)
  Ok "[OK] Replaced supabaseAdmin. -> sa."
} else {
  Info "[WARN] No supabaseAdmin. usage found (non-fatal)"
}

[System.IO.File]::WriteAllText($Target, $txt, $Utf8NoBom)
Ok "[OK] Patched: app/api/rides/fare-response/route.ts"
Ok "DONE. Next: run build."
