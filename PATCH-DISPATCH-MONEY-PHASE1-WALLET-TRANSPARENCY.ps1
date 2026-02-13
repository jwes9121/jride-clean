# PATCH-DISPATCH-MONEY-PHASE1-WALLET-TRANSPARENCY.ps1
# Money Phase 1: show wallet balance/min + low-wallet filter (Dispatch-only)
# Touches ONLY: app\dispatch\page.tsx
# Reversible via marker blocks + auto backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$ui = "app\dispatch\page.tsx"
if (-not (Test-Path $ui)) { Fail "Missing file: $ui (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$ui.bak.$stamp"
Copy-Item -Force $ui $bak
Ok "Backup: $bak"

$txt = Get-Content $ui -Raw

if ($txt -match "JRIDE_UI_MONEY_PHASE1_START") {
  Warn "Money Phase 1 marker already present. No changes made."
  exit 0
}

# 1) Add state for low-wallet filter near Search state block end (reliable marker)
$anchor = "/* JRIDE_UI_SEARCH_END */"
if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Could not find anchor: $anchor" }

$insState = @"

  /* JRIDE_UI_MONEY_PHASE1_START */
  const [lowWalletOnly, setLowWalletOnly] = useState<boolean>(false);
  /* JRIDE_UI_MONEY_PHASE1_END */
"@
$txt = $txt.Replace($anchor, ($anchor + $insState))
Ok "Inserted lowWalletOnly state."

# 2) Extend rowsFilteredUi memo to apply lowWalletOnly filter (hooks-safe)
if ($txt -notmatch "const rowsFilteredUi = useMemo") { Fail "rowsFilteredUi memo not found." }
if ($txt -notmatch "JRIDE_UI_SEARCH_V2_START") { Fail "Search V2 marker not found; aborting to avoid wrong file." }

# Add helper funcs right above rowsFilteredUi memo inside Search V2 block (safe string insert)
$needle = "const rowsFilteredUi = useMemo(() => {"
if ($txt -notmatch [regex]::Escape($needle)) { Fail "Could not find rowsFilteredUi memo start." }

$moneyHelpers = @"
  // Money Phase 1: wallet helpers (read-only)
  function toMoney(v: any) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  }
  function isLowWalletByDriver(d: any) {
    if (!d) return false;
    if (d.wallet_locked === true) return true;
    const bal = toMoney(d.wallet_balance);
    const min = toMoney(d.min_wallet_required);
    if (bal === null || min === null) return false;
    return bal < min;
  }

"@

# Only insert if not already present
if ($txt -notmatch "isLowWalletByDriver") {
  $txt = $txt.Replace($needle, ($moneyHelpers + $needle))
  Ok "Inserted money helpers into Search V2 block."
} else {
  Warn "Money helpers already present; skipping helper insertion."
}

# Now inject lowWalletOnly logic inside the filter function: after 'const d...' isn’t in memo, so we compute with driverLiveMap.
# We'll insert a check near the top of base.filter callback, after town/status extraction.

$rxFilterStart = '(?s)(return\s+base\.filter\(\(b:\s*any\)\s*=>\s*\{\s*[\s\S]*?const\s+status\s*=\s*normStatus\(getStatus\(b\)\);\s*)'
$m = [regex]::Match($txt, $rxFilterStart)
if (-not $m.Success) { Fail "Could not locate insertion point inside rowsFilteredUi filter callback." }

$lowWalletCheck = @"
      // Money Phase 1: optional low-wallet filter (driver locked / below minimum)
      if (lowWalletOnly) {
        const driverId = String(b?.driver_id ?? b?.assigned_driver_id ?? "");
        const d = driverId ? (driverLiveMap as any)?.[driverId] : null;
        if (!isLowWalletByDriver(d)) return false;
      }

"@

$txt = [regex]::Replace(
  $txt,
  $rxFilterStart,
  [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Groups[1].Value + $lowWalletCheck },
  1
)
Ok "Added lowWalletOnly filter to rowsFilteredUi."

# Ensure dependency list includes lowWalletOnly and driverLiveMap
$rxDeps = '\]\s*,\s*\[rowsUi,\s*qBooking,\s*qPhone,\s*qStatus,\s*qTown,\s*searchQ\]\s*\);'
if ($txt -match $rxDeps) {
  $txt = [regex]::Replace(
    $txt,
    $rxDeps,
    '], [rowsUi, qBooking, qPhone, qStatus, qTown, searchQ, lowWalletOnly, driverLiveMap]);',
    1
  )
  Ok "Updated rowsFilteredUi deps to include lowWalletOnly + driverLiveMap."
} else {
  Warn "Could not match deps line exactly; leaving deps as-is. If lint warns, we will patch deps next."
}

# 3) Add UI toggle inside the Quick filters bar (near Clear button)
$rxQuickBar = '(?s)(<button\s+[^>]*title="Clear search \+ quick filters"[\s\S]*?</button>\s*)'
$mq = [regex]::Match($txt, $rxQuickBar)
if (-not $mq.Success) { Fail "Could not find Quick filters Clear button to anchor UI toggle." }

$toggleUi = @"
                <label className="flex items-center gap-2 text-[11px] text-slate-600 ml-2">
                  <input
                    type="checkbox"
                    checked={lowWalletOnly}
                    onChange={(e) => setLowWalletOnly(e.target.checked)}
                  />
                  <span>Low-wallet only</span>
                </label>

"@

# Insert once after Clear button
$txt = [regex]::Replace(
  $txt,
  $rxQuickBar,
  [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Groups[1].Value + $toggleUi },
  1
)
Ok "Inserted Low-wallet toggle in Quick filters bar."

# 4) Enhance Driver cell to show wallet balance/min (read-only)
# Find the existing wallet_locked badge block and add a balance line above it.
$rxDriverCellWallet = '(?s)(const\s+lastLabel\s*=\s*[^;]*;\s*[\s\S]*?return\s*\(\s*<div className="flex flex-col gap-1">[\s\S]*?<span className="text-\[11px\] text-slate-500">\s*last:\s*\{lastLabel\}\s*<\/span>\s*)'
$md = [regex]::Match($txt, $rxDriverCellWallet)
if ($md.Success) {
  $walletLine = @"
                                {(() => {
                                  const bal = toMoney(d?.wallet_balance);
                                  const min = toMoney(d?.min_wallet_required);
                                  if (bal === null && min === null) return null;

                                  const low = isLowWalletByDriver(d);
                                  return (
                                    <span className={"text-[11px] " + (low ? "text-red-700" : "text-slate-600")}>
                                      ₱{bal === null ? "?" : bal.toFixed(2)} / min ₱{min === null ? "?" : min.toFixed(2)}
                                    </span>
                                  );
                                })()}
"@
  $txt = [regex]::Replace(
    $txt,
    $rxDriverCellWallet,
    [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Groups[1].Value + $walletLine },
    1
  )
  Ok "Added wallet balance/min line in Driver cell."
} else {
  Warn "Could not find Driver cell wallet insertion point; leaving Driver cell unchanged."
}

Set-Content -Path $ui -Value $txt -Encoding UTF8
Ok "Wrote patched file: $ui"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm run build" -ForegroundColor Cyan
Write-Host "2) npm run dev -> /dispatch: toggle Low-wallet only, verify Driver wallet line" -ForegroundColor Cyan
Write-Host "3) If deps warning shows, paste it and I’ll provide a tiny deps-fix patch" -ForegroundColor Cyan
