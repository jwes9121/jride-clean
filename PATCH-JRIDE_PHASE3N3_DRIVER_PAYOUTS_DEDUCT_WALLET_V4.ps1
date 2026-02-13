# PATCH-JRIDE_PHASE3N3_DRIVER_PAYOUTS_DEDUCT_WALLET_V4.ps1
# Fixes V3 injection: removes misplaced block, reinjects in correct scope
# Uses Supabase REST (SERVICE ROLE) to create driver_wallet_transactions debit on mark_paid
# Idempotent via reason = payout_request:<id>
# UTF-8 no BOM

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
$target = Join-Path $root "app\api\admin\driver-payouts\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Ok "[OK] Backup: $target.bak.$ts"

$txt = Get-Content $target -Raw

# 1) Remove any prior injected block (V3) if present
$txt2 = $txt -replace "(?s)\s*// ----- PHASE 3N\.3: DEDUCT DRIVER WALLET ON MARK_PAID.*?// ----- END PHASE 3N\.3 -----\s*", "`n"

# 2) Ensure we haven't already injected V4
if ($txt2 -match "PHASE 3N\.3 V4: DEDUCT DRIVER WALLET ON MARK_PAID") {
  Ok "[SKIP] V4 block already present."
  Ok "DONE"
  exit 0
}

# 3) Insert V4 block right before: const patch: any = {
$anchor = "const patch: any = {"
$idx = $txt2.IndexOf($anchor)
if ($idx -lt 0) {
  Fail "Could not find anchor '$anchor' in $target. Paste your route.ts if it changed."
}

$inject = @'
    // ----- PHASE 3N.3 V4: DEDUCT DRIVER WALLET ON MARK_PAID (REST, IDEMPOTENT) -----
    // When admin marks payout as PAID, create a driver_wallet_transactions debit once.
    // Idempotency key: reason = payout_request:<id>
    if (targetStatus === "paid") {
      const driverId = String(cur.row?.driver_id || "");
      const payoutAmt = Number(cur.row?.amount || 0);
      const reason = `payout_request:${id}`;

      if (!driverId) return jsonErr("BAD_DATA", "Missing driver_id on payout request", 400, { id });
      if (!(payoutAmt > 0)) return jsonErr("BAD_DATA", "Invalid payout amount", 400, { id, amount: cur.row?.amount });

      // check existing debit (idempotent)
      const exQs = new URLSearchParams();
      exQs.set("select", "id");
      exQs.set("driver_id", "eq." + driverId);
      exQs.set("reason", "eq." + reason);
      exQs.set("limit", "1");

      const exUrl = SUPABASE_URL + "/rest/v1/driver_wallet_transactions?" + exQs.toString();
      const exRes = await fetch(exUrl, {
        headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
        cache: "no-store",
      });
      const exText = await exRes.text();
      if (!exRes.ok) return jsonErr("DB_ERROR", exText || "Failed to check existing wallet tx", 500, { stage: "wallet_existing", id });

      let exArr: any[] = [];
      try { exArr = JSON.parse(exText || "[]"); } catch { exArr = []; }
      const already = Array.isArray(exArr) && exArr.length > 0;

      if (!already) {
        // balance lookup
        const bQs = new URLSearchParams();
        bQs.set("select", "driver_id,balance");
        bQs.set("driver_id", "eq." + driverId);
        bQs.set("limit", "1");

        const bUrl = SUPABASE_URL + "/rest/v1/driver_wallet_balances_v1?" + bQs.toString();
        const bRes = await fetch(bUrl, {
          headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
          cache: "no-store",
        });
        const bText = await bRes.text();
        if (!bRes.ok) return jsonErr("DB_ERROR", bText || "Failed to load wallet balance", 500, { stage: "wallet_balance", id });

        let bArr: any[] = [];
        try { bArr = JSON.parse(bText || "[]"); } catch { bArr = []; }
        const balanceBefore = Number((Array.isArray(bArr) && bArr[0] ? bArr[0].balance : 0) || 0);

        if (balanceBefore < payoutAmt) {
          return jsonErr("INSUFFICIENT_BALANCE", "Driver wallet balance is insufficient for payout", 409, {
            id,
            driver_id: driverId,
            balance: balanceBefore,
            payout_amount: payoutAmt,
          });
        }

        const balanceAfter = Number((balanceBefore - payoutAmt).toFixed(2));

        // insert debit
        const insUrl = SUPABASE_URL + "/rest/v1/driver_wallet_transactions?select=id";
        const insRes = await fetch(insUrl, {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: "Bearer " + SERVICE_ROLE,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify([{
            driver_id: driverId,
            amount: -Math.abs(payoutAmt),
            balance_after: balanceAfter,
            reason,
            booking_id: null,
          }]),
          cache: "no-store",
        });

        const insText = await insRes.text();
        if (!insRes.ok) return jsonErr("DB_ERROR", insText || "Failed to insert wallet debit", 500, { stage: "wallet_insert", id });
      }
    }
    // ----- END PHASE 3N.3 V4 -----

'@

$before = $txt2.Substring(0, $idx)
$after  = $txt2.Substring($idx)
$out = $before + $inject + $after

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $out, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
