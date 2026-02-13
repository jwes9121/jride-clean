# PATCH-JRIDE_PHASE3N3_DRIVER_PAYOUTS_DEDUCT_WALLET_V1.ps1
# Adds wallet deduction when admin marks payout request as PAID:
# - Reads driver balance from driver_wallet_balances_v1
# - Inserts negative driver_wallet_transactions row (idempotent via reason = payout_request:<id>)
# - Prevents marking paid if insufficient balance
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
$target = Join-Path $root "app\api\admin\driver-payouts\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Ok "[OK] Backup: $target.bak.$ts"

$txt = Get-Content $target -Raw

# 1) Inject helper functions (balance lookup + existing payout tx lookup + insert tx)
if ($txt -notmatch "restGetDriverBalance\(") {
  $injectPoint = "async function restPatchById"
  $idx = $txt.IndexOf($injectPoint)
  if ($idx -lt 0) { Fail "Anchor not found: $injectPoint" }

  # Insert AFTER restPatchById() function (right before export async function GET)
  $pattern = "(async function restPatchById[\s\S]*?\n\})\n\nexport async function GET"
  if ($txt -notmatch $pattern) { Fail "Could not locate restPatchById block end." }

  $insert = @'
$1

async function restGetDriverBalance(SUPABASE_URL: string, SERVICE_ROLE: string, driver_id: string) {
  const qs = new URLSearchParams();
  qs.set("select", "driver_id,balance");
  qs.set("driver_id", "eq." + driver_id);
  qs.set("limit", "1");
  const url = SUPABASE_URL + "/rest/v1/driver_wallet_balances_v1?" + qs.toString();

  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let arr: any[] = [];
  try { arr = JSON.parse(text || "[]"); } catch { arr = []; }
  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
  const bal = row ? Number(row.balance || 0) : 0;
  return { ok: true, balance: bal, row };
}

async function restFindExistingPayoutTx(
  SUPABASE_URL: string,
  SERVICE_ROLE: string,
  driver_id: string,
  reason: string
) {
  const qs = new URLSearchParams();
  qs.set("select", "id,driver_id,amount,balance_after,reason,created_at");
  qs.set("driver_id", "eq." + driver_id);
  qs.set("reason", "eq." + reason);
  qs.set("limit", "1");
  const url = SUPABASE_URL + "/rest/v1/driver_wallet_transactions?" + qs.toString();

  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let arr: any[] = [];
  try { arr = JSON.parse(text || "[]"); } catch { arr = []; }
  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
  return { ok: true, row };
}

async function restInsertDriverWalletTx(
  SUPABASE_URL: string,
  SERVICE_ROLE: string,
  tx: Record<string, any>
) {
  const url = SUPABASE_URL + "/rest/v1/driver_wallet_transactions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(tx),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let out: any[] = [];
  try { out = JSON.parse(text || "[]"); } catch { out = []; }
  return { ok: true, row: Array.isArray(out) && out.length ? out[0] : null };
}

export async function GET
'@

  $txt = [regex]::Replace($txt, $pattern, $insert, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

# 2) Inject wallet deduction logic inside POST before restPatchById() when targetStatus === "paid"
if ($txt -notmatch "payout_request:\s*\" \+ id") {
  $anchor = "const upd = await restPatchById"
  if ($txt.IndexOf($anchor) -lt 0) { Fail "Anchor not found in POST: $anchor" }

  $walletBlock = @'
    // ----- WALLET DEDUCTION ON PAID (IDEMPOTENT) -----
    if (targetStatus === "paid") {
      const driverId = String(cur.row.driver_id || "");
      const payoutAmt = Number(cur.row.amount || 0);
      if (!driverId) return jsonErr("BAD_ROW", "Missing driver_id on payout request", 400, { id });
      if (!(payoutAmt > 0)) return jsonErr("BAD_ROW", "Invalid payout amount", 400, { id, amount: cur.row.amount });

      const reason = "payout_request:" + id;

      // Idempotency: if tx already exists for this payout id, skip inserting again.
      const ex = await restFindExistingPayoutTx(SUPABASE_URL, SERVICE_ROLE, driverId, reason);
      if (!ex.ok) return jsonErr("DB_ERROR", ex.text || "Failed to check existing payout tx", 500, { stage: "check_existing_tx" });

      if (!ex.row) {
        const bal0 = await restGetDriverBalance(SUPABASE_URL, SERVICE_ROLE, driverId);
        if (!bal0.ok) return jsonErr("DB_ERROR", bal0.text || "Failed to load driver balance", 500, { stage: "balance" });

        const balanceBefore = Number(bal0.balance || 0);
        if (balanceBefore < payoutAmt) {
          return jsonErr("INSUFFICIENT_BALANCE", "Driver balance is below payout amount", 409, {
            driver_id: driverId,
            balance: balanceBefore,
            payout_amount: payoutAmt,
            id,
          });
        }

        const balanceAfter = Number((balanceBefore - payoutAmt).toFixed(2));
        const tx = {
          id: (globalThis as any).crypto?.randomUUID ? (globalThis as any).crypto.randomUUID() : undefined,
          driver_id: driverId,
          amount: -Math.abs(payoutAmt),
          balance_after: balanceAfter,
          reason,
          booking_id: null,
          created_at: new Date().toISOString(),
        };

        // If id is undefined (older runtime), delete it to let DB default handle it.
        if (!tx.id) { delete (tx as any).id; }

        const ins = await restInsertDriverWalletTx(SUPABASE_URL, SERVICE_ROLE, tx);
        if (!ins.ok) return jsonErr("DB_ERROR", ins.text || "Failed to insert wallet payout tx", 500, { stage: "insert_wallet_tx" });
      }
    }

'@

  $txt = $txt -replace [regex]::Escape($anchor), ($walletBlock + $anchor)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
