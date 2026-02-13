# JRIDE Wallet Routes Scan Report

Generated: 2026-02-07 06:12:03
Repo: C:\Users\jwes9\Desktop\jride-clean-fresh

## 1) Key Wallet Files (existence)

- app\api\wallet\adjust\route.ts : OK
- app\api\wallet\transactions\route.ts : OK
- app\api\wallet\audit\route.ts : OK
- app\admin\wallet-adjust\page.tsx : OK

## 2) Keyword Hits (app/**)

| file | hits | key terms |
|---|---:|---|
| app\api\public\passenger\can-book\route.ts | 33 | wallet_balance, min_wallet_required, wallet_locked |
| app\dispatch\page.tsx | 18 | wallet_balance, min_wallet_required, wallet_locked |
| app\api\dispatch\status\route.ts | 15 | driver_wallet_transactions, vendor_wallet_transactions, balance_after |
| app\api\driver\wallet\route.ts | 10 | driver_wallet_transactions, wallet_balance, min_wallet_required, wallet_locked, balance_after |
| app\api\admin\ops\wallet-reconciliation\route.ts | 9 | driver_wallet_transactions, vendor_wallet_transactions, wallet_balance |
| app\api\dispatch\drivers-live\route.ts | 9 | wallet_balance, min_wallet_required, wallet_locked |
| app\api\public\passenger\book\route.ts | 9 | wallet_balance, min_wallet_required, wallet_locked |
| app\api\admin\reconcile-wallets\route.ts | 8 | driver_wallet_transactions, vendor_wallet_transactions, wallet_balance |
| app\ride\page.tsx | 7 | wallet_balance, min_wallet_required, wallet_locked |
| app\takeout\admin\payouts\page.tsx | 7 | wallet_balance |
| app\takeout\vendor\payout\page.tsx | 7 | wallet_balance |
| app\admin\livetrips\components\TripWalletPanel.tsx | 6 | wallet_balance, balance_after |
| app\admin\payouts\drivers\page.tsx | 6 | wallet_balance, min_wallet_required |
| app\api\admin\reconcile-wallets\fix\route.ts | 6 | driver_wallet_transactions, wallet_balance, balance_after |
| app\wallet\page.tsx | 6 | wallet_balance |
| app\api\admin\wallet\transactions\route.ts | 5 | driver_wallet_transactions, vendor_wallet_transactions, wallet_balance, admin_get_driver_wallet_balance_v1 |
| app\api\admin\wallet\vendor-summary\route.ts | 5 | vendor_wallet_transactions, wallet_balance |
| app\api\wallet\transactions\route.ts | 5 | driver_wallet_transactions, wallet_balance, min_wallet_required, wallet_locked, balance_after |
| app\api\admin\wallet\adjust\route.ts | 4 | vendor_wallet_transactions, admin_adjust_driver_wallet |
| app\api\wallet\adjust\route.ts | 4 | admin_adjust_driver_wallet, admin_adjust_driver_wallet_audited, admin_driver_cashout_load_wallet |
| app\driver\page.tsx | 4 | wallet_balance, min_wallet_required |
| app\driver\wallet\page.tsx | 4 | balance_after |
| app\api\admin\wallet\driver-summary\route.ts | 3 | driver_wallet_transactions, wallet_balance |
| app\api\takeout\vendor\payout\details\route.ts | 3 | vendor_wallet_transactions, wallet_balance |
| app\api\wallet\audit\route.ts | 3 | wallet_admin_audit, before_balance, after_balance |
| app\admin\livetrips\components\AdminOpsPanel.tsx | 2 | wallet_balance |
| app\admin\livetrips\components\TripControlWalletPanel.tsx | 2 | wallet_balance |
| app\admin\ops\wallet-reconciliation\page.tsx | 2 | wallet_balance |
| app\api\takeout\admin\vendor-payout\settle-request\route.ts | 2 | vendor_wallet_transactions |
| app\api\takeout\vendor\payout\request\route.ts | 2 | wallet_balance |
| app\api\takeout\vendor\payout\route.ts | 2 | vendor_wallet_transactions |
| app\api\takeout\vendor\request-payout\route.ts | 2 | wallet_balance |
| app\api\takeout\vendor-wallet\route.ts | 2 | vendor_wallet_transactions |
| app\api\vendor\payout-request\route.ts | 2 | vendor_wallet_transactions, wallet_balance |
| app\admin\wallet-adjust\page.tsx | 1 | admin_driver_cashout_load_wallet |
| app\api\admin\dispatch\assign\route.ts | 1 | wallet_locked |
| app\api\driver\payout-request\route.ts | 1 | wallet_balance |

## 3) Wallet Route Summaries (snippets)

### app\api\wallet\adjust\route.ts

Top keyword snippets:

- TERM: admin_adjust_driver_wallet

```
(audited)
    const amount = Math.abs(rawAmount);
    const reasonText = String(body.reason || "Manual Topup (Admin Credit)").trim() || "Manual Topup (Admin Credit)";

    const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
      p_driver_id: driverId,
      p_amount: amount,
      p_reason: reasonText,
      p_created_by: createdBy,
      p_method: method,
      p_external_ref: externalRef,
```

- TERM: admin_driver_cashout_load_wallet

```
us: 400 });
    if (!Number.isFinite(rawAmount) || rawAmount === 0) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });

    // CASHOUT path uses DB function you already tested:
    // admin_driver_cashout_load_wallet(p_driver_id uuid, p_cashout_amount numeric, p_created_by text, p_method text, p_external_ref text, p_request_id uuid)
    if (reasonMode === "manual_cashout") {
      const cashoutAmoun
```

### app\api\wallet\transactions\route.ts

Top keyword snippets:

- TERM: wallet_balance

```
f (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID_OR_Q" }, { status: 400 });

    const { data: drow, error: derr } = await supabase
      .from("drivers")
      .select("id, driver_name, wallet_balance, min_wallet_required, wallet_locked, driver_status")
      .eq("id", driverId)
      .limit(1);

    if (derr) return NextResponse.json({ ok: false, error: "DRIVER_READ_FAILED", message: derr.message }
```

- TERM: driver_wallet_transactions

```
xtResponse.json({ ok: false, error: "DRIVER_READ_FAILED", message: derr.message }, { status: 500 });

    const driver = (drow || [])[0] || null;

    const { data: txs, error: txErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, created_at, amount, balance_after, reason, booking_id")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (t
```

### app\api\wallet\audit\route.ts

Top keyword snippets:

- TERM: wallet_admin_audit

```
d = (url.searchParams.get("driver_id") || "").trim();
    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });

    const { data, error } = await supabase
      .from("wallet_admin_audit")
      .select("created_at, driver_id, amount, reason, created_by, method, external_ref, receipt_ref, request_id, before_balance, after_balance, status, error_message")
      .eq("driver_id", driver
```

### app\admin\wallet-adjust\page.tsx

Top keyword snippets:

- TERM: admin_driver_cashout_load_wallet

```
"Loading audit..." : "Load Wallet Audit"}
                </button>
              </div>

              <div className="mt-2 text-xs opacity-60">
                Uses audited functions where available. Cashout uses admin_driver_cashout_load_wallet (non-negative safety enforced by DB).
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-black/10 p-4">
            <d
```

## 4) Snapshot vs Ledger Detectors

Counts of snapshot usage (drivers.wallet_balance) vs ledger usage (driver_wallet_transactions).

| file | wallet_balance hits | driver_wallet_transactions hits |
|---|---:|---:|
| app\admin\livetrips\components\AdminOpsPanel.tsx | 2 | 0 |
| app\admin\livetrips\components\TripControlWalletPanel.tsx | 2 | 0 |
| app\admin\livetrips\components\TripWalletPanel.tsx | 5 | 0 |
| app\admin\ops\wallet-reconciliation\page.tsx | 2 | 0 |
| app\admin\payouts\drivers\page.tsx | 3 | 0 |
| app\api\admin\ops\wallet-reconciliation\route.ts | 5 | 2 |
| app\api\admin\reconcile-wallets\route.ts | 4 | 2 |
| app\api\admin\reconcile-wallets\fix\route.ts | 1 | 2 |
| app\api\admin\wallet\driver-summary\route.ts | 1 | 2 |
| app\api\admin\wallet\transactions\route.ts | 2 | 1 |
| app\api\admin\wallet\vendor-summary\route.ts | 2 | 0 |
| app\api\dispatch\drivers-live\route.ts | 3 | 0 |
| app\api\dispatch\status\route.ts | 0 | 6 |
| app\api\driver\payout-request\route.ts | 1 | 0 |
| app\api\driver\wallet\route.ts | 2 | 1 |
| app\api\public\passenger\book\route.ts | 3 | 0 |
| app\api\public\passenger\can-book\route.ts | 11 | 0 |
| app\api\takeout\vendor\payout\details\route.ts | 1 | 0 |
| app\api\takeout\vendor\payout\request\route.ts | 2 | 0 |
| app\api\takeout\vendor\request-payout\route.ts | 2 | 0 |
| app\api\vendor\payout-request\route.ts | 1 | 0 |
| app\api\wallet\transactions\route.ts | 1 | 1 |
| app\dispatch\page.tsx | 6 | 0 |
| app\driver\page.tsx | 2 | 0 |
| app\ride\page.tsx | 2 | 0 |
| app\takeout\admin\payouts\page.tsx | 7 | 0 |
| app\takeout\vendor\payout\page.tsx | 7 | 0 |
| app\wallet\page.tsx | 6 | 0 |
