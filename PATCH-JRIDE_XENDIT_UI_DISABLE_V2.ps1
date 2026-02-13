# PATCH-JRIDE_XENDIT_UI_DISABLE_V2.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$targets = @(
  "$root\components\PaymentMethodModal.tsx",
  "$root\components\components\PaymentMethodModal.tsx"
)

foreach ($path in $targets) {
  if (-not (Test-Path $path)) {
    Warn "Skip (not found): $path"
    continue
  }

  Info "Patching: $path"
  Copy-Item -Force $path "$path.bak.$(Stamp)"
  Ok "Backup created."

  $txt = Get-Content -Path $path -Raw

  # 0) Ensure xenditEnabled exists (some versions already have it)
  if ($txt -notmatch "const\s+xenditEnabled\s*=") {
    $pat = "export\s+default\s+function\s+PaymentMethodModal\s*\([^\)]*\)\s*\{"
    $m = [regex]::Match($txt, $pat)
    if ($m.Success) {
      $inject = $m.Value + "`r`n  const xenditEnabled = process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1';`r`n"
      $txt = $txt.Substring(0, $m.Index) + $inject + $txt.Substring($m.Index + $m.Length)
      Ok "Injected xenditEnabled flag."
    } else {
      Warn "Could not inject xenditEnabled (function signature not matched)."
    }
  }

  # 1) Disable selecting gcash_xendit when not enabled
  # Replace ANY: setSelectedMethod('gcash_xendit')
  # with: xenditEnabled && setSelectedMethod('gcash_xendit')
  $before = $txt
  $txt = [regex]::Replace(
    $txt,
    "setSelectedMethod\(\s*['""]gcash_xendit['""]\s*\)",
    "xenditEnabled && setSelectedMethod('gcash_xendit')"
  )
  if ($txt -ne $before) { Ok "Selection guarded by xenditEnabled." } else { Warn "No setSelectedMethod('gcash_xendit') found (maybe already guarded)." }

  # 2) Add disabled attr on the button if it exists (best effort)
  # If your button line exists as "<button" near the GCash block, we try to insert disabled={!xenditEnabled}
  if ($txt -match "GCash") {
    # Insert disabled={!xenditEnabled} for the first button that contains the guarded click.
    $txt = [regex]::Replace(
      $txt,
      "(<button[^>]*\s+onClick=\{\s*\(\)\s*=>\s*xenditEnabled\s*&&\s*setSelectedMethod\('gcash_xendit'\)\s*\}[^>]*)(>)",
      "`$1 disabled={!xenditEnabled}`$2",
      1
    )
  }

  # 3) Add "Coming soon" badge near the GCash label (best effort)
  # Replace exact label if present:
  $labelFrom = '<div className="font-semibold">GCash Payment</div>'
  if ($txt.Contains($labelFrom)) {
    $labelTo = @'
<div className="font-semibold flex items-center space-x-2">
  <span>GCash Payment</span>
  {!xenditEnabled && (
    <span className="bg-gray-300 text-gray-700 text-xs px-2 py-1 rounded-full">
      Coming soon
    </span>
  )}
</div>
'@
    $txt = $txt.Replace($labelFrom, $labelTo)
    Ok "Inserted 'Coming soon' badge."
  } else {
    Warn "GCash label exact match not found (badge not inserted). This is OK; selection is still disabled."
  }

  # 4) Confirm hard-stop when disabled (no TS union issues)
  # Replace the first occurrence of:
  # if (selectedMethod === 'gcash_xendit') {
  # with a safe cast check using xenditEnabled.
  $confirmFrom = "if (selectedMethod === 'gcash_xendit') {"
  if ($txt.Contains($confirmFrom)) {
    $confirmTo = @"
if (((selectedMethod as any) === 'gcash_xendit')) {
      if (!xenditEnabled) {
        alert('GCash via Xendit is coming soon (under verification). Please use Cash or Wallet for now.');
        return;
      }
"@
    $txt = $txt.Replace($confirmFrom, $confirmTo)
    Ok "Hardened confirm flow for disabled Xendit."
  } else {
    Warn "Confirm block not found to harden (may already be guarded)."
  }

  Set-Content -Path $path -Value $txt -Encoding UTF8
  Ok "Patched: $path"
}

Ok "DONE: Xendit UI disable polish applied (V2)."
