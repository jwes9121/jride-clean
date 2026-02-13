# FIX-JRIDE_VALIDATE_SUPABASE_ENV_V1.ps1
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

$root = (Get-Location).Path
$envFile = Join-Path $root ".env.local"

if (!(Test-Path $envFile)) { Die ".env.local not found at: $envFile" }

$raw = Get-Content -Raw -LiteralPath $envFile

function GetEnvVal($name){
  $m = [regex]::Match($raw, "(?m)^\s*$([regex]::Escape($name))\s*=\s*(.*)\s*$")
  if (!$m.Success) { return $null }
  $v = $m.Groups[2].Value.Trim()
  # strip surrounding quotes
  if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
    $v = $v.Substring(1, $v.Length-2)
  }
  return $v
}

function Mask($v){
  if (!$v) { return "" }
  if ($v.Length -le 8) { return ("*" * $v.Length) }
  return ($v.Substring(0,4) + "..." + $v.Substring($v.Length-4))
}

$keys = @(
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY"
)

Ok "== JRIDE Supabase env check (.env.local) =="
foreach($k in $keys){
  $v = GetEnvVal $k
  if (!$v) { Warn "[MISSING] $k" ; continue }
  if ($k -like "*URL") {
    Ok "[OK] $k = $v"
    if ($v -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
      Warn "  -> URL format looks wrong. Expected: https://<project-ref>.supabase.co"
    }
  } else {
    Ok "[OK] $k present (masked): $(Mask $v)"
    if ($v -match '\s') { Warn "  -> Key contains whitespace (likely broken copy/paste)." }
  }
}

# Detect any hardcoded supabase host inside repo (common cause)
Ok ""
Ok "== Searching repo for hardcoded *.supabase.co =="
$matches = Get-ChildItem -Recurse -File -Path $root -Include *.ts,*.tsx,*.js,*.jsx,*.env*,*.md -ErrorAction SilentlyContinue |
  Select-String -Pattern '\.supabase\.co' -SimpleMatch -ErrorAction SilentlyContinue

if ($matches) {
  Warn "Found hardcoded supabase hosts in these files (review):"
  $matches | Select-Object -First 30 | ForEach-Object { " - $($_.Path):$($_.LineNumber)" } | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  if ($matches.Count -gt 30) { Warn "  (more matches exist; refine search if needed)" }
} else {
  Ok "No hardcoded *.supabase.co found in scanned files."
}

Ok ""
Ok "[DONE] If the build still shows ENOTFOUND/Invalid API key, your URL/key pair does not match the same Supabase project."
