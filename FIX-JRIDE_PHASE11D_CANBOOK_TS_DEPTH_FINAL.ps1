# FIX-JRIDE_PHASE11D_CANBOOK_TS_DEPTH_FINAL.ps1
# Final fix for TS "excessively deep" error by casting Supabase client to any
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = Join-Path (Get-Location) "app\api\public\passenger\can-book\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# Replace supabase.from(...) with (supabase as any).from(...)
$pattern = '\bsupabase\s*\.from\s*\('
$replacement = '(supabase as any).from('

if ($txt -notmatch $pattern) {
  Fail "Could not find supabase.from(...) to patch."
}

$txt = [regex]::Replace($txt, $pattern, $replacement)

if ($txt -eq $orig) {
  Fail "No changes produced (unexpected)."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Patched: cast Supabase client to any before .from()"
Info "Now run npm build."
