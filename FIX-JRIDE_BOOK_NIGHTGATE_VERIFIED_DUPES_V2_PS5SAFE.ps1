param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Info "== JRIDE Fix: Book route night gate verified block (V2 / PS5-safe) =="

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\api\public\passenger\book\route.ts"

if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

# backup
$bakDir = Join-Path $proj "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.BOOK_NIGHTGATE_VERIFIED_DUPES_V2.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw

# 1) Replace the entire V1 alignment block with a clean V2 block.
$blockPattern = '(?s)// === JRIDE_VERIFICATION_ALIGNMENT_PATCH_V1 ===.*?// === END JRIDE_VERIFICATION_ALIGNMENT_PATCH_V1 ==='
$blockReplacement = @'
// === JRIDE_VERIFICATION_ALIGNMENT_PATCH_V2 ===
// Night gate verification must align with legacy DB table constraints.
// Source of truth (legacy): public.passenger_verifications.status
// Allowed "verified" statuses include: approved_admin (legacy), approved (OptionB), verified (generic).
const safeUserId = user?.id ?? "00000000-0000-0000-0000-000000000000";

const { data: pv } = await supabase
  .from("passenger_verifications")
  .select("status")
  .eq("user_id", safeUserId)
  .maybeSingle();

const pvStatus = String((pv as any)?.status ?? "").toLowerCase().trim();

let verified =
  !!user?.id &&
  (pvStatus === "approved_admin" || pvStatus === "approved" || pvStatus === "verified");

// Fallback: Option B table (requests) can be 'approved' even if legacy table row is missing.
if (!verified && user?.id) {
  try {
    const { data: reqRow } = await supabase
      .from("passenger_verification_requests")
      .select("status")
      .eq("passenger_id", user.id)
      .maybeSingle();

    const rs = String((reqRow as any)?.status ?? "").toLowerCase().trim();
    if (rs === "approved" || rs === "approved_admin" || rs === "verified") verified = true;
  } catch {}
}
// === END JRIDE_VERIFICATION_ALIGNMENT_PATCH_V2 ===
'@

if ($src -match $blockPattern) {
  $src = [regex]::Replace($src, $blockPattern, $blockReplacement, "Singleline")
  Ok "[OK] Replaced verification alignment block (V1 -> V2)."
} else {
  throw "Could not find the V1 alignment block markers. Aborting to avoid breaking the file."
}

# 2) Remove any leftover inline `if (nightGate && !pvVerified) { return NextResponse.json(...) }` blocks.
$src = [regex]::Replace(
  $src,
  '(?s)\s*if\s*\(\s*nightGate\s*&&\s*!\s*pvVerified\s*\)\s*\{.*?\}\s*',
  "`n",
  "Singleline"
)

# 3) Remove ALL occurrences of `let verified = pvVerified;` (we now own `verified` above).
$src2 = [regex]::Replace(
  $src,
  '(?m)^\s*let\s+verified\s*=\s*pvVerified\s*;\s*$',
  '',
  "Multiline"
)

# 4) Remove any accidental shadow `let verified = pvVerified;` inside else blocks on same line (from bad patch).
$src2 = [regex]::Replace(
  $src2,
  '(?s)\}\s*else\s*\{\s*let\s+verified\s*=\s*pvVerified\s*;\s*\}\s*',
  "`n",
  "Singleline"
)

# 5) OPTIONAL: if pvVerified identifier still exists (declared/used), normalize it away safely.
# Replace `pvVerified` with `verified` ONLY when used as a boolean (simple heuristic).
$src2 = $src2 -replace '\bpvVerified\b', 'verified'

Set-Content -LiteralPath $target -Value $src2 -Encoding UTF8
Ok "[OK] Patched: $target"

Info "Next: npm.cmd run build"