# FIX-JRIDE_VENDOR_ORDERS_ROUTE_NEWLINE_BEFORE_SUPABASE_INSERT.ps1
# Fixes the accidental "exist.const" glue by inserting a newline before:
# const { data, error } = await supabase

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
$before = $txt

# Most specific fix: "exist.const { data, error }"
$txt = $txt -replace 'exist\.const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s*supabase', "exist.`r`n`r`nconst { data, error } = await supabase"

# Fallback fix if slightly different glue occurred (".const { data, error } = await supabase")
$txt = $txt -replace '\.\s*const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s*supabase', ".`r`n`r`nconst { data, error } = await supabase"

if ($txt -eq $before) {
  Fail "No change produced. Paste lines 55-85 of app/api/vendor-orders/route.ts."
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched newline before supabase insert in: $rel"
