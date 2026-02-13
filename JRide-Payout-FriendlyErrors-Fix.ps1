param()

function Fail($msg) { throw $msg }

function Find-FirstFileContaining([string]$pattern, [string[]]$exts) {
  foreach ($ext in $exts) {
    $files = Get-ChildItem -Path . -Recurse -File -Filter "*$ext" -ErrorAction SilentlyContinue
    foreach ($f in $files) {
      try {
        $txt = Get-Content -Raw -LiteralPath $f.FullName -ErrorAction Stop
        if ($txt -match $pattern) { return $f.FullName }
      } catch {}
    }
  }
  return $null
}

function Backup-File($path) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak_$stamp"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Write-UTF8NoBOM($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

# ---------- 1) Patch auto-approve API route (return clean code/message) ----------
Write-Host ""
Write-Host "=== JRide Fix: Friendly payout errors (NO MANUAL EDITS) ===" -ForegroundColor Cyan

$apiAutoApprove = Find-FirstFileContaining "driver-payouts/auto-approve|admin_auto_approve_driver_payouts|Run auto-approve" @(".ts",".tsx")
if (-not $apiAutoApprove) {
  # common exact path (if not found by search)
  $candidate = Join-Path $PWD "app\api\admin\driver-payouts\auto-approve\route.ts"
  if (Test-Path $candidate) { $apiAutoApprove = $candidate }
}

if (-not $apiAutoApprove) {
  Write-Host "⚠ Could not find auto-approve API route automatically. Skipping API patch." -ForegroundColor Yellow
} else {
  $bak = Backup-File $apiAutoApprove
  Write-Host "✅ Backup: $bak" -ForegroundColor DarkGray

  $apiContent = @"
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function normalizePostgrestError(err: any) {
  const rawMsg = (err?.message ?? "").toString();
  const rawCode = (err?.code ?? "").toString();

  // Common “business rule” exceptions from SQL (RAISE EXCEPTION)
  if (rawMsg.toLowerCase().includes("insufficient wallet")) {
    return { code: "INSUFFICIENT_WALLET", message: "Insufficient wallet balance for payout." };
  }

  // No pending payouts / nothing to do
  if (rawMsg.toLowerCase().includes("no pending") || rawMsg.toLowerCase().includes("nothing to auto-approve")) {
    return { code: "NO_PENDING", message: "Nothing to auto-approve (no pending payouts)." };
  }

  // Rule disabled
  if (rawMsg.toLowerCase().includes("rule") && rawMsg.toLowerCase().includes("off")) {
    return { code: "RULE_OFF", message: "Auto-approve rule is OFF. Enable it in driver_payout_rules." };
  }

  // fallback
  return { code: rawCode || "UNKNOWN", message: rawMsg || "Request failed." };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Number(body?.limit ?? body?.p_limit ?? 50);

    const sb = supabaseAdmin();

    // Your RPC name:
    const { data, error } = await sb.rpc("admin_auto_approve_driver_payouts", { p_limit: limit });

    if (error) {
      const n = normalizePostgrestError(error);
      return NextResponse.json(
        { ok: false, code: n.code, message: n.message, debug: { raw: error } },
        { status: 400 }
      );
    }

    // If your SQL returns JSON with counters, keep it.
    return NextResponse.json({ ok: true, ...(data ?? {}) });
  } catch (e: any) {
    const msg = (e?.message ?? "Server error").toString();
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: msg }, { status: 500 });
  }
}
"@

  Write-UTF8NoBOM $apiAutoApprove $apiContent
  Write-Host "✅ Patched API: $apiAutoApprove" -ForegroundColor Green
}

# ---------- 2) Patch Admin payout pages: show friendly banner instead of long JSON ----------
# We patch TWO likely pages:
# - "Driver Payout Reports"
# - "Driver Payouts"

$adminReports = Find-FirstFileContaining "Driver Payout Reports" @(".tsx")
$adminList    = Find-FirstFileContaining "Driver Payouts" @(".tsx")

function Patch-AdminPage($path) {
  if (-not $path) { return }

  $txt = Get-Content -Raw -LiteralPath $path

  # Ensure helpers exist (idempotent)
  if ($txt -notmatch "function friendlyMsg") {
    $txt = $txt -replace '"use client";', @"
"use client";

function friendlyMsg(input: any): { title: string, detail?: string } {
  // input can be: string | { ok,false,code,message,debug } | Error
  const raw = typeof input === "string" ? input : (input?.message ?? input?.toString?.() ?? "");
  const code = input?.code ?? input?.error_code ?? input?.name ?? "";
  const msg = (input?.message ?? raw ?? "").toString();

  const lc = msg.toLowerCase();

  if (code === "INSUFFICIENT_WALLET" || lc.includes("insufficient wallet")) {
    return { title: "Insufficient wallet balance.", detail: "Top up the driver wallet so it stays above minimum after payout." };
  }
  if (code === "NO_PENDING" || lc.includes("no pending") || lc.includes("nothing to auto-approve")) {
    return { title: "Nothing to auto-approve (no pending payouts)." };
  }
  if (code === "RULE_OFF" || (lc.includes("rule") && lc.includes("off"))) {
    return { title: "Auto-approve rule is OFF.", detail: "Enable it in driver_payout_rules." };
  }

  // generic fallback
  return { title: msg ? msg : "Request failed.", detail: code ? `Code: ${code}` : undefined };
}
"@
  }

  # Replace alert(JSON.stringify(data)) patterns -> nicer alert
  $txt = $txt -replace 'alert\(`Auto-approve done: \$\{JSON\.stringify\(data\)\}`\);', 'alert(friendlyMsg(data).title);'

  # Replace setErr(e.message) -> setErr(friendly message)
  # Handles both: setErr(e?.message || String(e))
  $txt = $txt -replace 'setErr\(\s*e\?\.\s*message\s*\|\|\s*String\(e\)\s*\)\s*;', 'setErr(friendlyMsg(e).title);'
  $txt = $txt -replace 'setErr\(\s*e\?\.\s*message\s*\|\|\s*String\(e\)\s*\)\s*', 'setErr(friendlyMsg(e).title)'

  # If UI prints raw JSON error in red, we can’t reliably target without exact markup.
  # But we can make errors short by ensuring err state stays short title.

  Write-UTF8NoBOM $path $txt
  Write-Host "✅ Patched Admin UI: $path" -ForegroundColor Green
}

if ($adminReports) { Backup-File $adminReports | Out-Null; Patch-AdminPage $adminReports } else { Write-Host "⚠ Could not find 'Driver Payout Reports' page to patch." -ForegroundColor Yellow }
if ($adminList)    { Backup-File $adminList    | Out-Null; Patch-AdminPage $adminList }    else { Write-Host "⚠ Could not find 'Driver Payouts' page to patch." -ForegroundColor Yellow }

# ---------- 3) Patch Driver payout request UI (driver_request_payout) ----------
$driverUI = Find-FirstFileContaining "driver_request_payout" @(".tsx")

if (-not $driverUI) {
  Write-Host "⚠ Could not find driver payout request UI to patch (driver_request_payout)." -ForegroundColor Yellow
} else {
  Backup-File $driverUI | Out-Null
  $txt = Get-Content -Raw -LiteralPath $driverUI

  if ($txt -notmatch "function friendlySbError") {
    # Insert helper after "use client";
    $txt = $txt -replace '"use client";', @"
"use client";

function friendlySbError(err: any): string {
  const msg = (err?.message ?? "").toString();
  const lc = msg.toLowerCase();

  if (lc.includes("insufficient wallet")) return "Insufficient wallet balance.";
  if (lc.includes("below minimum") || lc.includes("min_wallet")) return "Wallet is below minimum required.";
  if (lc.includes("not found")) return "Record not found.";
  return msg || "Request failed.";
}
"@
  }

  # Replace the “if (error) { ... alert(error.message) }” under driver_request_payout
  # Keep it simple: short alert + console full.
  $txt = $txt -replace 'if\s*\(\s*error\s*\)\s*\{\s*([\s\S]*?)\s*\}', 'if (error) { console.error(error); alert(friendlySbError(error)); return; }'

  Write-UTF8NoBOM $driverUI $txt
  Write-Host "✅ Patched Driver UI: $driverUI" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE. Next steps:" -ForegroundColor Cyan
Write-Host "1) Restart dev server (npm run dev) if running." -ForegroundColor Gray
Write-Host "2) Test:" -ForegroundColor Gray
Write-Host "   - Driver requests payout below minimum => should show: 'Insufficient wallet balance.'" -ForegroundColor Gray
Write-Host "   - Admin auto-approve => should show clean message (no long red JSON)." -ForegroundColor Gray
