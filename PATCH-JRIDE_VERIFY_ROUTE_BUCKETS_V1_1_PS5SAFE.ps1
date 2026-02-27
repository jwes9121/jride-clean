param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host $m -ForegroundColor Green }
function Write-Fail($m) { Write-Host $m -ForegroundColor Red }

Write-Info "== JRIDE Patch: Verify request route - use existing buckets (V1_1 / PS5-safe) =="

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\api\public\passenger\verification\request\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Write-Fail "[FAIL] Not found: $target"
  exit 1
}

# backup
$bakDir = Join-Path $proj "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.VERIFY_BUCKETS_V1_1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw

# --- 1) Replace the single bucket definition with 2 bucket defs ---
# We handle either:
#   const bucket = process.env.VERIFICATION_BUCKET || "passenger-verifications";
# or any default string.
$bucketPattern = 'const\s+bucket\s*=\s*process\.env\.VERIFICATION_BUCKET\s*\|\|\s*"[^"]+"\s*;'
$bucketReplacement = 'const idBucket = process.env.VERIFICATION_ID_BUCKET || "passenger-ids";' + "`r`n" +
                     '  const selfieBucket = process.env.VERIFICATION_SELFIE_BUCKET || "passenger-selfies";'

if ($src -match $bucketPattern) {
  $src = [regex]::Replace($src, $bucketPattern, $bucketReplacement, 1)
  Write-Ok "[OK] Updated bucket constants to idBucket/selfieBucket."
} else {
  Write-Fail "[FAIL] Could not find bucket constant line (VERIFICATION_BUCKET)."
  Write-Info "Open route.ts and confirm it still contains: process.env.VERIFICATION_BUCKET"
  exit 2
}

# --- 2) Update upload helper signature to accept bucketName ---
$src = $src -replace 'async\s+function\s+uploadToBucket\s*\(\s*file:\s*File\s*,\s*keyPrefix:\s*string\s*\)',
                     'async function uploadToBucket(file: File, bucketName: string, keyPrefix: string)'

# --- 3) Replace supabase.storage.from(bucket) -> from(bucketName) ---
$src = $src -replace 'supabase\.storage\.from\(\s*bucket\s*\)', 'supabase.storage.from(bucketName)'

# --- 4) Replace error text bucket=${bucket} -> bucket=${bucketName} (if present) ---
$src = $src -replace 'bucket=\$\{bucket\}', 'bucket=${bucketName}'

# --- 5) Update calls to uploadToBucket() ---
# id_front upload call
$src = $src -replace 'uploadToBucket\(\s*f\s*,\s*"id_front"\s*\)',
                     'uploadToBucket(f, idBucket, "id_front")'
# selfie upload call
$src = $src -replace 'uploadToBucket\(\s*f\s*,\s*"selfie_with_id"\s*\)',
                     'uploadToBucket(f, selfieBucket, "selfie_with_id")'

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Write-Ok "[OK] Patched: $target"

Write-Host ""
Write-Info "Defaults now match your real buckets:"
Write-Info "  ID bucket: passenger-ids"
Write-Info "  Selfie bucket: passenger-selfies"
Write-Info "Optional Vercel env vars (only if you want explicit):"
Write-Info "  VERIFICATION_ID_BUCKET=passenger-ids"
Write-Info "  VERIFICATION_SELFIE_BUCKET=passenger-selfies"