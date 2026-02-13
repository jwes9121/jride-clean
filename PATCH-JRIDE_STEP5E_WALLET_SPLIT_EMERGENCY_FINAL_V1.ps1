# PATCH-JRIDE_STEP5E_WALLET_SPLIT_EMERGENCY_FINAL_V1.ps1
$ErrorActionPreference = "Stop"

function Die([string]$msg) { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\status\route.ts"
if (!(Test-Path $target)) { Die "Missing file: $target" }

$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$target.bak.$stamp"
Copy-Item $target $backup -Force
Write-Host "[OK] Backup: $backup"

$txt = Get-Content -LiteralPath $target -Raw

# Prevent double-apply
$marker = "/* ===== JRIDE STEP 5E: EMERGENCY WALLET SPLIT ===== */"
if ($txt -match [regex]::Escape($marker)) {
  Write-Host "[OK] STEP 5E marker already present. No changes."
  exit 0
}

# ---------------------------------------------------------
# 1) Inject STEP 5E helper functions near top (after envFirst)
# ---------------------------------------------------------
$injectHelpers = @"
$marker
const STEP5E_DRIVER_CREDIT = 20;
const STEP5E_COMPANY_FEE = 15;

// Company "vendor id" for platform ledger rows (REQUIRED for vendor_wallet_transactions).
// Set in env (Vercel + local):
//   COMPANY_VENDOR_ID=<uuid>
// Optional fallbacks:
const STEP5E_COMPANY_VENDOR_ID =
  (typeof envFirst === "function"
    ? envFirst("COMPANY_VENDOR_ID", "PLATFORM_VENDOR_ID", "JRIDE_COMPANY_VENDOR_ID")
    : (process.env.COMPANY_VENDOR_ID || process.env.PLATFORM_VENDOR_ID || process.env.JRIDE_COMPANY_VENDOR_ID || "")
  ).trim();

async function step5eHasDriverCredit(supabase: any, bookingId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("driver_wallet_transactions")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("reason", "emergency_pickup_fee_driver")
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function step5eNextBalanceAfter(supabase: any, driverId: string, delta: number): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("driver_wallet_transactions")
      .select("balance_after")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return delta;
    const last = Array.isArray(data) && data.length ? Number(data[0]?.balance_after ?? 0) : 0;
    const next = last + Number(delta);
    return Number.isFinite(next) ? next : Number(delta);
  } catch {
    return Number(delta);
  }
}

async function step5eHasCompanyFee(supabase: any, bookingCode: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("vendor_wallet_transactions")
      .select("id")
      .eq("booking_code", bookingCode)
      .eq("kind", "company_convenience_fee")
      .eq("amount", STEP5E_COMPANY_FEE)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

function step5eWarn(msg: string) {
  try {
    const g: any = globalThis as any;
    if (!Array.isArray(g.__jrideWarnings)) g.__jrideWarnings = [];
    g.__jrideWarnings.push(msg);
  } catch {}
  try { console.warn(msg); } catch {}
}

async function step5eApplyEmergencyWalletSplitOnce(supabase: any, booking: any) {
  const isEmergency = Boolean(booking?.is_emergency);
  if (!isEmergency) return;

  const bookingId = String(booking?.id ?? "").trim();
  const bookingCode = String(booking?.booking_code ?? "").trim();
  const driverId = String(booking?.driver_id ?? "").trim();

  if (!bookingId || !driverId) {
    step5eWarn("STEP5E_SKIP_MISSING_BOOKING_OR_DRIVER");
    return;
  }

  // ---- Driver credit +20 (idempotent by booking_id + reason) ----
  const alreadyDriver = await step5eHasDriverCredit(supabase, bookingId);
  if (!alreadyDriver) {
    const balanceAfter = await step5eNextBalanceAfter(supabase, driverId, STEP5E_DRIVER_CREDIT);
    const { error } = await supabase.from("driver_wallet_transactions").insert({
      driver_id: driverId,
      amount: STEP5E_DRIVER_CREDIT,
      balance_after: balanceAfter,
      reason: "emergency_pickup_fee_driver",
      booking_id: bookingId,
    });
    if (error) step5eWarn("STEP5E_DRIVER_INSERT_FAILED: " + error.message);
  }

  // ---- Company fee +15 (idempotent by booking_code + kind + amount) ----
  if (!bookingCode) {
    step5eWarn("STEP5E_SKIP_MISSING_BOOKING_CODE");
    return;
  }
  if (!STEP5E_COMPANY_VENDOR_ID) {
    // Do not guess vendor_id. Configure COMPANY_VENDOR_ID in env.
    step5eWarn("STEP5E_SKIP_MISSING_COMPANY_VENDOR_ID");
    return;
  }

  const alreadyCompany = await step5eHasCompanyFee(supabase, bookingCode);
  if (!alreadyCompany) {
    const { error } = await supabase.from("vendor_wallet_transactions").insert({
      vendor_id: STEP5E_COMPANY_VENDOR_ID,
      booking_code: bookingCode,
      amount: STEP5E_COMPANY_FEE,
      kind: "company_convenience_fee",
      note: "Emergency convenience fee",
    });
    if (error) step5eWarn("STEP5E_COMPANY_INSERT_FAILED: " + error.message);
  }
}
/* ===== END JRIDE STEP 5E ===== */
"@

# Anchor after envFirst() helper (present in your routes)
$anchorEnvFirstEnd = 'function envFirst\([\s\S]*?\n\}'
if ($txt -notmatch $anchorEnvFirstEnd) {
  Die "Could not find envFirst() function block to inject STEP 5E helpers."
}
$txt = [regex]::Replace($txt, $anchorEnvFirstEnd, "`$0`n`n$injectHelpers`n", 1)

# ---------------------------------------------------------
# 2) Call STEP 5E at the start of the completion-wallet logic
#    Anchor: comment '// 1) Apply platform/company cut'
# ---------------------------------------------------------
$anchorCut = '^[ \t]*// 1\)\s*Apply platform\/company cut.*$'
if ($txt -notmatch $anchorCut) {
  Die "Could not find anchor comment: // 1) Apply platform/company cut"
}

$callBlock = @"
  // ----- JRIDE STEP 5E: Emergency Wallet Split (idempotent; once per booking) -----
  try {
    await step5eApplyEmergencyWalletSplitOnce(supabase, booking);
  } catch (e: any) {
    try { step5eWarn("STEP5E_UNEXPECTED: " + String(e?.message ?? e)); } catch {}
  }

"@

$txt = [regex]::Replace($txt, $anchorCut, $callBlock + '$0', 1, [System.Text.RegularExpressions.RegexOptions]::Multiline)

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "IMPORTANT ENV (set on Vercel + local):" -ForegroundColor Yellow
Write-Host "  COMPANY_VENDOR_ID=<uuid of your platform/company vendor ledger owner>"
Write-Host ""
Write-Host "RUN NEXT:" -ForegroundColor Cyan
Write-Host "  npm run build"
