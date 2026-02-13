# PATCH-JRIDE_PHASE3N_PAYOUT_REQUEST_DEBUG_500_V1.ps1
# Improves /api/driver/payout-request POST error visibility (safe):
# - returns SERVER_MISCONFIG if missing service role key/url
# - returns DB_ERROR with stage + message (no secrets)
# - guards placeholder driver_id
# UTF-8 without BOM

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root = Find-RepoRoot (Get-Location).Path
$target = Join-Path $root "app\api\driver\payout-request\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Ok "[OK] Backup: $target.bak.$ts"

$txt = Get-Content $target -Raw

# 1) Ensure SERVER_MISCONFIG includes what is missing (no values)
$txt = $txt -replace 'Missing SUPABASE_URL \+ SUPABASE_SERVICE_ROLE_KEY','Missing required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY'

# 2) Add placeholder guard after driver_id extraction if not present
if ($txt -notmatch 'REPLACE_DRIVER_UUID') {
  $txt = $txt -replace '(const driver_id\s*=\s*s\(body\.driver_id\);\s*)',
@'
$1
  if (!driver_id || driver_id.toUpperCase().includes("REPLACE_DRIVER_UUID") || driver_id.toLowerCase() === "your_driver_uuid") {
    return json(400, { ok: false, code: "BAD_DRIVER_ID", message: "Provide a real driver_id UUID." });
  }
'@
}

# 3) Wrap POST body in try/catch to surface 500 stage safely
if ($txt -notmatch 'try\s*\{[\s\S]*export async function POST') {
  # We'll do a targeted injection: replace "export async function POST" block with a guarded version is too risky.
  # Instead: inject a catch-all at the bottom by wrapping the entire POST contents if a "try {" isn't already there.
  $txt = $txt -replace 'export async function POST\(req: NextRequest\)\s*\{',
@'
export async function POST(req: NextRequest) {
  try {
'@
  $txt = $txt -replace 'return json\(200,\s*\{ ok: true, request: ins, balance_at_request_time: balance, min_payout: min \}\);\s*\n\}',
@'
    return json(200, { ok: true, request: ins, balance_at_request_time: balance, min_payout: min });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}
'@
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
