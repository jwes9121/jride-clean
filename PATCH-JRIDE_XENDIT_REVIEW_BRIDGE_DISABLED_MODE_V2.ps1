# PATCH-JRIDE_XENDIT_REVIEW_BRIDGE_DISABLED_MODE_V2.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
Info "Repo root: $root"

# ---------- Targets (NO Join-Path inside array literal) ----------
$modalPaths = @(
  "$root\components\PaymentMethodModal.tsx",
  "$root\components\components\PaymentMethodModal.tsx"
)

$createInvoicePath = "$root\app\api\payments\xendit\create-invoice\route.ts"
$webhookPath       = "$root\app\api\payments\xendit\webhook\route.ts"

# ---------- Helpers ----------
function Backup-File([string]$path) {
  if (-not (Test-Path $path)) { return }
  $bak = "$path.bak.$(NowStamp)"
  Copy-Item -Force $path $bak
  Ok "Backup: $bak"
}

function Ensure-DirForFile([string]$filePath) {
  $dir = Split-Path -Parent $filePath
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Ok "Created dir: $dir"
  }
}

function Write-TextUtf8([string]$path, [string]$content) {
  Ensure-DirForFile $path
  Set-Content -Path $path -Value $content -Encoding UTF8
  Ok "Wrote: $path"
}

function Upsert-FileIfMissing([string]$path, [string]$content) {
  if (Test-Path $path) {
    Warn "Exists (kept): $path"
    return
  }
  Write-TextUtf8 $path $content
}

# ---------- 1) Create API routes (disabled-but-ready) ----------
$createInvoiceCode = @'
import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function isEnabled() {
  return process.env.NEXT_PUBLIC_XENDIT_ENABLED === "1";
}

export async function POST(req: Request) {
  try {
    const enabled = isEnabled();
    const secret = process.env.XENDIT_SECRET_KEY || "";

    if (!enabled || !secret) {
      return json(503, {
        ok: false,
        code: "PAYMENTS_TEMP_DISABLED",
        message: "Xendit is not enabled (under verification).",
        enabled,
        hasSecret: Boolean(secret),
      });
    }

    const payload = await req.json().catch(() => ({}));
    const amount = Number(payload?.amount || 0);
    const external_id = String(payload?.external_id || "");

    if (!amount || amount <= 0 || !external_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "amount and external_id are required." });
    }

    const description = payload?.description ? String(payload.description) : "JRide Wallet Top-up";
    const customer = payload?.customer || null;
    const success_redirect_url = payload?.success_redirect_url ? String(payload.success_redirect_url) : undefined;
    const failure_redirect_url = payload?.failure_redirect_url ? String(payload.failure_redirect_url) : undefined;

    const body: any = { external_id, amount, description };
    if (customer) body.customer = customer;
    if (success_redirect_url) body.success_redirect_url = success_redirect_url;
    if (failure_redirect_url) body.failure_redirect_url = failure_redirect_url;

    const auth = Buffer.from(`${secret}:`).toString("base64");

    const res = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return json(502, {
        ok: false,
        code: "XENDIT_CREATE_INVOICE_FAILED",
        status: res.status,
        message: data?.message || "Failed to create invoice.",
        raw: data,
      });
    }

    return json(200, { ok: true, invoice: data });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
'@

$webhookCode = @'
import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function getHeader(req: Request, name: string) {
  return req.headers.get(name) || req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  try {
    const token = process.env.XENDIT_WEBHOOK_TOKEN || "";
    const got = getHeader(req, "x-callback-token") || "";

    if (!token) {
      return json(503, { ok: false, code: "PAYMENTS_TEMP_DISABLED", message: "Webhook token not configured." });
    }

    if (!got || got !== token) {
      return json(401, { ok: false, code: "UNAUTHORIZED", message: "Invalid webhook token." });
    }

    const payload = await req.json().catch(() => ({}));

    console.log("[xendit-webhook] received", {
      id: payload?.id,
      external_id: payload?.external_id,
      status: payload?.status,
      amount: payload?.amount,
      paid_amount: payload?.paid_amount,
      payment_method: payload?.payment_method,
      updated: payload?.updated,
    });

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
'@

Info "Adding Xendit API routes (disabled-but-ready)..."
Upsert-FileIfMissing $createInvoicePath $createInvoiceCode
Upsert-FileIfMissing $webhookPath       $webhookCode

# ---------- 2) Patch PaymentMethodModal (both possible paths) ----------
function Patch-PaymentMethodModal([string]$path) {
  if (-not (Test-Path $path)) {
    Warn "Not found (skip): $path"
    return
  }

  Info "Patching: $path"
  Backup-File $path

  $txt = Get-Content -Path $path -Raw -ErrorAction Stop

  # Add flag inside component if missing
  if ($txt -notmatch "NEXT_PUBLIC_XENDIT_ENABLED") {
    $pattern = "export\s+default\s+function\s+PaymentMethodModal\s*\([^\)]*\)\s*\{"
    $m = [regex]::Match($txt, $pattern)
    if ($m.Success) {
      $inject = $m.Value + "`r`n  const xenditEnabled = process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1';`r`n"
      $txt = $txt.Substring(0, $m.Index) + $inject + $txt.Substring($m.Index + $m.Length)
      Ok "Injected xenditEnabled flag."
    } else {
      Warn "Could not locate PaymentMethodModal() opening to inject flag."
    }
  }

  # Guard confirm
  if ($txt -notmatch "PAYMENTS_TEMP_DISABLED_UI") {
    $callPattern = "onConfirm\s*\(\s*selectedMethod\s*\)"
    $m2 = [regex]::Match($txt, $callPattern)
    if ($m2.Success) {
      $guard = @"
if (selectedMethod === 'gcash_xendit' && !(process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1')) {
        alert('GCash via Xendit is coming soon (under verification). Please use Cash/Wallet for now.');
        return; // PAYMENTS_TEMP_DISABLED_UI
      }

"@
      $txt = $txt.Substring(0, $m2.Index) + $guard + $txt.Substring($m2.Index)
      Ok "Added UI confirm guard."
    } else {
      Warn "Could not find onConfirm(selectedMethod) call to guard."
    }
  }

  # Add visible hint comment near first occurrence
  if ($txt -notmatch "Coming soon \(under verification\)") {
    $idx = $txt.IndexOf("'gcash_xendit'")
    if ($idx -ge 0) {
      $note = "`r`n  {/* GCash via Xendit: Coming soon (under verification) */}`r`n"
      $txt = $txt.Substring(0, $idx) + $note + $txt.Substring($idx)
      Ok "Inserted UI note comment near gcash_xendit."
    }
  }

  Set-Content -Path $path -Value $txt -Encoding UTF8
  Ok "Patched: $path"
}

Info "Patching PaymentMethodModal duplicates (if present)..."
foreach ($p in $modalPaths) { Patch-PaymentMethodModal $p }

Write-Host ""
Ok "NEXT STEPS (ENV VARS):"
Write-Host "Add to .env.local and Vercel:" -ForegroundColor Yellow
Write-Host "  NEXT_PUBLIC_XENDIT_ENABLED=0"
Write-Host "  XENDIT_SECRET_KEY=sk_test_or_live_here"
Write-Host "  XENDIT_WEBHOOK_TOKEN=your_callback_token_here"
Write-Host ""
Write-Host "When approved, flip:" -ForegroundColor Yellow
Write-Host "  NEXT_PUBLIC_XENDIT_ENABLED=1"
Write-Host ""

Ok "DONE."
