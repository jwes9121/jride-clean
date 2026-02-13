# PATCH-JRIDE_WALLET_UI_AND_SCAN_V5.ps1
# PS5-safe, UTF-8 no BOM writes, no fancy operators, no broken quoting.

$ErrorActionPreference = "Stop"

function NowStamp() {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function Assert-File($p) {
  if (!(Test-Path -LiteralPath $p)) { throw "Missing file: $p" }
}

function Backup-File($p) {
  $stamp = NowStamp
  $bak = "$p.bak.$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  return $bak
}

function Read-Text($p) {
  return [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom($p, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $content, $enc)
}

function Replace-OrThrow($src, $pattern, $replacement, $label) {
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (!$rx.IsMatch($src)) { throw "Anchor not found for: $label" }
  return $rx.Replace($src, $replacement, 1)
}

function Replace-IfFound($src, $pattern, $replacement) {
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($rx.IsMatch($src)) {
    return $rx.Replace($src, $replacement, 1)
  }
  return $src
}

Write-Host "== JRIDE Patch: Wallet UI + Scan (V5 / PS5-safe) =="

# --- Repo root (current folder) ---
$REPO = (Get-Location).Path
Write-Host ("Repo: " + $REPO)

# Paths
$UI_PAGE = Join-Path $REPO "app\admin\wallet-adjust\page.tsx"
$SCAN_OUT = Join-Path $REPO "WALLET_BALANCE_WITHOUT_LEDGER_REPORT.md"
$SCAN_SCRIPT = Join-Path $REPO "SCAN-JRIDE_WALLET_BALANCE_WITHOUT_LEDGER_REPORT_V3.ps1"

Assert-File $UI_PAGE

# ------------------------------------------------------------------------------------
# 1) Write scan script (app/api + app/admin): wallet_balance but NOT driver_wallet_transactions
# ------------------------------------------------------------------------------------
$scan = @'
$ErrorActionPreference = "Stop"
function NowStamp() { return (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }

$repo = (Get-Location).Path
$roots = @(
  Join-Path $repo "app\api",
  Join-Path $repo "app\admin"
)

$want = "wallet_balance"
$not  = "driver_wallet_transactions"

$rows = @()

foreach ($root in $roots) {
  if (!(Test-Path -LiteralPath $root)) { continue }

  $files = Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx 2>$null
  foreach ($f in $files) {
    $txt = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)

    if ($txt -match $want) {
      if (!($txt -match $not)) {
        # capture a short snippet line
        $snip = ""
        $lines = $txt -split "`r?`n"
        for ($i=0; $i -lt $lines.Length; $i++) {
          if ($lines[$i] -match $want) {
            $snip = $lines[$i].Trim()
            break
          }
        }

        $rows += [PSCustomObject]@{
          file = $f.FullName.Substring($repo.Length).TrimStart("\","/")
          snippet = $snip
        }
      }
    }
  }
}

# Write markdown report
$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# JRIDE - Files containing `wallet_balance` but NOT `driver_wallet_transactions`")
$null = $sb.AppendLine("")
$null = $sb.AppendLine(("* Generated: " + (NowStamp)))
$null = $sb.AppendLine("")
$null = $sb.AppendLine("| file | snippet |")
$null = $sb.AppendLine("| --- | --- |")

if ($rows.Count -eq 0) {
  $null = $sb.AppendLine("| (none) | (none) |")
} else {
  foreach ($r in ($rows | Sort-Object file)) {
    $f = $r.file.Replace("|","\|")
    $s = ($r.snippet + "").Replace("|","\|")
    if ($s.Length -gt 180) { $s = $s.Substring(0,180) + "..." }
    $null = $sb.AppendLine(("| `" + $f + "` | " + $s + " |"))
  }
}

$outPath = Join-Path $repo "WALLET_BALANCE_WITHOUT_LEDGER_REPORT.md"
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), $enc)

Write-Host ("[OK] Wrote: " + $outPath)
'@

Write-TextUtf8NoBom $SCAN_SCRIPT $scan
Write-Host ("[OK] Wrote: " + $SCAN_SCRIPT)

# ------------------------------------------------------------------------------------
# 2) Patch UI: enforce negative amount for cashout at submit time + add audit panel if missing
# ------------------------------------------------------------------------------------
$bak = Backup-File $UI_PAGE
Write-Host ("[OK] Backup: " + $bak)

$src = Read-Text $UI_PAGE

# (A) Enforce negative amount for cashout: patch the submit handler area.
# We look for a common pattern: building payload with amount, reason_mode, etc.
# If your file differs, we patch near the fetch('/api/wallet/adjust') call.
$src2 = $src

# Insert a small normalization block right before the request body is created.
# Anchor: a line containing "/api/wallet/adjust" (fetch URL).
$injectPattern = '(\bfetch\s*\(\s*[^)]*?/api/wallet/adjust[^)]*\)\s*[,)]\s*\{)'
if (($src2 -match $injectPattern) -and !($src2 -match "JRIDE_CASHOUT_FORCE_NEGATIVE_V1")) {
  # Find a safe place earlier: before fetch call, inside the same function, we add a normalize block.
  # Anchor on the fetch line and insert just above it.
  $src2 = Replace-OrThrow `
    -src $src2 `
    -pattern '(\n\s*)(\bfetch\s*\(\s*[^)]*?/api/wallet/adjust[^)]*\)\s*[,)]\s*\{)' `
    -replacement "`$1// JRIDE_CASHOUT_FORCE_NEGATIVE_V1`n`$1// If reasonMode indicates cashout, force amount to be negative.`n`$1try {`n`$1  const rm = (reasonMode || reason_mode || '').toString();`n`$1  if (rm === 'manual_cashout') {`n`$1    const n = Number(amount);`n`$1    if (!isNaN(n) && n > 0) {`n`$1      // @ts-ignore`n`$1      if (typeof setAmount === 'function') setAmount(String(-Math.abs(n)));`n`$1    }`n`$1  }`n`$1} catch (e) {}`n`$1`$2" `
    -label "insert cashout force-negative block before fetch(/api/wallet/adjust)"
}

# (B) Ensure an Audit panel exists (many of your earlier patches already added it).
# If missing, append a minimal section under the Lookup panel or before Response.
if (!($src2 -match "Wallet Admin Audit") -and !($src2 -match "/api/wallet/audit")) {
  # Insert before the "Response" section header if present.
  $src2 = Replace-IfFound `
    -src $src2 `
    -pattern '(\n\s*<div[^>]*>\s*Response\s*</div>|\n\s*<h[1-6][^>]*>\s*Response\s*</h[1-6]>)' `
    -replacement @"
`n        {/* Wallet Admin Audit (confirmation / accountability) */} 
        <div className="mt-6 rounded-xl border p-4">
          <div className="text-sm font-semibold">Wallet Admin Audit (confirmation / accountability)</div>
          <div className="text-xs opacity-70">Shows receipt_ref, before/after balance, status, and error_message for topups/cashouts.</div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={async () => {
                try {
                  const did = (driverId || "").trim();
                  if (!did) return;
                  const r = await fetch("/api/wallet/audit?driver_id=" + encodeURIComponent(did));
                  const j = await r.json();
                  // @ts-ignore
                  setAuditRows?.(j?.rows || j || null);
                } catch (e) {}
              }}
            >
              Load Wallet Audit
            </button>
          </div>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-black/5 p-3 text-xs">
            {/* @ts-ignore */}
            {typeof auditRows !== "undefined" && auditRows ? JSON.stringify(auditRows, null, 2) : "(no audit loaded yet)"}
          </pre>
        </div>
$1
"@
}

# Write back if changed
if ($src2 -ne $src) {
  Write-TextUtf8NoBom $UI_PAGE $src2
  Write-Host ("[OK] Patched: " + $UI_PAGE)
} else {
  Write-Host ("[OK] No UI changes needed (already patched): " + $UI_PAGE)
}

Write-Host ""
Write-Host "Next:"
Write-Host "1) Run scanner: powershell -ExecutionPolicy Bypass -File .\SCAN-JRIDE_WALLET_BALANCE_WITHOUT_LEDGER_REPORT_V3.ps1"
Write-Host "2) Rebuild: npm.cmd run build"
Write-Host "== Done =="
