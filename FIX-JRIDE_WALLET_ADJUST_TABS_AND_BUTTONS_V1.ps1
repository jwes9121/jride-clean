# FIX-JRIDE_WALLET_ADJUST_TABS_AND_BUTTONS_V1.ps1
# - Fixes invalid "<button<button"
# - Restores proper Vendor Adjust / Vendor Settle tab UI (removes accidental driver-block duplication)
# - Adds Lookup buttons for driver/vendor into the existing lookup panel
# - Safe: creates timestamped backup before editing

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Backup-File($path) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-Between([string]$txt, [string]$startMarker, [string]$endMarker, [string]$replacementIncludingStartButNotEnd) {
  $s = $txt.IndexOf($startMarker)
  if ($s -lt 0) { Fail "Start marker not found: $startMarker" }
  $e = $txt.IndexOf($endMarker, $s + $startMarker.Length)
  if ($e -lt 0) { Fail "End marker not found: $endMarker" }

  $before = $txt.Substring(0, $s)
  $after  = $txt.Substring($e) # keep endMarker and everything after
  return $before + $replacementIncludingStartButNotEnd + $after
}

# --- Locate repo root ---
$root = (Get-Location).Path
Write-Host "[INFO] Repo root: $root"

$target = Join-Path $root "app\admin\wallet-adjust\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

Backup-File $target

$txt = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# --- 1) Fix invalid JSX token ---
$txt = $txt.Replace("<button<button", "<button")

# --- 2) Vendor Adjust tab: replace the whole block (start -> before vendor_settle start) ---
$vendorAdjustStart = '{tab === "vendor_adjust" && ('
$vendorSettleStart = '{tab === "vendor_settle" && ('

$vendorAdjustBlock = @'
      {tab === "vendor_adjust" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor wallet adjustment entry</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Vendor ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="vendor_id (uuid)"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Amount</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="amount (e.g. 250 or -100)"
                value={vendorAmount}
                onChange={(e) => setVendorAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Kind</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="adjustment | earning | payout | etc"
                value={vendorKind}
                onChange={(e) => setVendorKind(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Note</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="manual_adjust"
                value={vendorNote}
                onChange={(e) => setVendorNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => runVendorLookup(vendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5 disabled:opacity-50"
              title="Shows balance + last 20 vendor transactions in the Lookup panel"
            >
              Lookup Vendor
            </button>

            <button
              disabled={busy}
              onClick={runVendorAdjust}
              className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Insert Vendor Adjustment"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Inserts a row into <code>vendor_wallet_transactions</code> (booking_code null). Does not require Xendit/GCash.
          </div>
        </div>
      )}

'@

$txt = Replace-Between $txt $vendorAdjustStart $vendorSettleStart $vendorAdjustBlock

# --- 3) Vendor Settle tab: replace whole block (start -> before Lookup panel) ---
$lookupPanelStart = '<div className="rounded-xl border border-black/10 p-4 space-y-2">'
if ($txt.IndexOf($lookupPanelStart) -lt 0) { Fail "Lookup panel start not found; expected marker: $lookupPanelStart" }

$vendorSettleBlock = @'
      {tab === "vendor_settle" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor settle full balance (payout)</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Vendor ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="vendor_id (uuid)"
                value={settleVendorId}
                onChange={(e) => setSettleVendorId(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Note</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="Cash payout settlement"
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => runVendorLookup(settleVendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5 disabled:opacity-50"
              title="Shows balance + last 20 vendor transactions in the Lookup panel"
            >
              Lookup Vendor
            </button>

            <button
              disabled={busy}
              onClick={runVendorSettle}
              className="rounded-xl bg-amber-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Settle Vendor Wallet (Full Payout)"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Uses <code>settle_vendor_wallet</code> (inserts negative payout row and resets vendor_wallet.balance).
          </div>
        </div>
      )}

'@

$txt = Replace-Between $txt $vendorSettleStart $lookupPanelStart $vendorSettleBlock

# --- 4) Driver tab: keep your existing dropdown/reason/receipt, but fix the Apply/Lookup buttons area safely ---
# We only ensure the driver section has a proper Lookup button (no big rewrite), by inserting a small button
# just before "Apply Driver Adjustment" if not already present.
$needleApply = '{busy ? "Working..." : "Apply Driver Adjustment"}'
if ($txt -notmatch [regex]::Escape('onClick={() => runDriverLookup(driverId.trim())}')) {
  $insertBefore = '<button'  # we'll insert above the first button in the driver action area (after the grid)
  # Find a stable spot: right after the closing </div> of the grid in driver tab and before the action button.
  $marker = "</div>`n`n <button"
  if ($txt.Contains($marker)) {
    $txt = $txt.Replace($marker, @"
</div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => runDriverLookup(driverId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5 disabled:opacity-50"
              title="Shows balance + last 20 driver transactions in the Lookup panel"
            >
              Lookup Driver
            </button>
"@ + "`n`n <button")
  }
}

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  npm.cmd run build"
