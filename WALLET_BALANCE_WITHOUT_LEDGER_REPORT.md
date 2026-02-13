# JRIDE - Files containing 'wallet_balance' but NOT 'driver_wallet_transactions'

- Generated: 2026-02-07 09:47:22

| file | snippet |
| --- | --- |
| app\admin\livetrips\components\AdminOpsPanel.tsx | <div className="font-semibold">{s(selectedTrip.driver_wallet ?? selectedTrip.driver_wallet_balance ?? "-")}</div> |
| app\admin\livetrips\components\AdminOpsPanel.tsx.bak.20260109_082623 | <div className="font-semibold">{s(selectedTrip.driver_wallet ?? selectedTrip.driver_wallet_balance ?? "-")}</div> |
| app\admin\livetrips\components\TripControlWalletPanel.tsx | <div className="text-sm font-semibold">{money(trip?.driver_wallet_balance ?? trip?.driver_wallet ?? trip?.driver_balance)}</div> |
| app\admin\livetrips\components\TripWalletPanel.tsx | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251223-024227 | () => trip?.driver_wallet_balance ?? trip?.driver_wallet ?? trip?.driverWallet ?? null, |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251223-024853 | () => trip?.driver_wallet_balance ?? trip?.driver_wallet ?? trip?.driverWallet ?? null, |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251223-025241 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251228_172059 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251228_172636 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251228_172914 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20251228_182934 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260109_082623 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260116_225500 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260117_005822 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260117_010152 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260117_010447 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260117_010944 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak.20260117_055807 | const vb = asNum(trip?.vendor_wallet_balance); |
| app\admin\livetrips\components\TripWalletPanel.tsx.bak_20251217_224446 | () => trip?.driver_wallet ?? trip?.driver_wallet_balance ?? trip?.driverWallet ?? null, |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_042230 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_042708 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_055533 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_090745 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_091318 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\livetrips\LiveTripsClient.tsx.bak_20251218_092006 | asNum(selectedTrip?.driver_wallet_balance) ?? |
| app\admin\ops\wallet-reconciliation\page.tsx | <div><div className="text-xs text-slate-500">wallet</div><div className="font-mono">{n(r.wallet_balance).toFixed(2)}</div></div> |
| app\admin\payouts\drivers\page.tsx | wallet_balance?: number \| null; |
| app\admin\reports\lgu\page.tsx.bak.20260114_025051 | : ["vendor_id","total_billings","total_platform_fees","total_vendor_earnings","wallet_balance","last_payout_at","last_payout_amount"]) |
| app\api\admin\livetrips\page-data\page-data_route | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-032552 | // Fetch driver balances (view must exist: driver_wallet_balances_v1) |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-033030 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-034103 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-063813 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-063956 | driver_wallet_balance: driverWallet, |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-064359 | driver_wallet_balance: driverWallet, |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-201904 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-214709 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251222-214950 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251224-190446 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251224-191149 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251224-191323 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251229_091249 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251230_202826 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251230_233623 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251230_235653 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak.20251231_052947 | .from("driver_wallet_balances_v1") |
| app\api\admin\livetrips\page-data\route.ts.bak_20251218_040008 | driver_wallet_balance: driverBal, |
| app\api\admin\vendor-payouts\route.ts.bak.20260113_215815 | .from("vendor_wallet_balances_v1") |
| app\api\admin\wallet\vendor-summary\route.ts | const sources = ["vendor_wallet_balance_view", "vendor_wallet_balances_v1"]; |
| app\api\admin\wallet\vendor-summary\route.ts.bak.20260119_105256 | const balUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet_balances_v1?vendor_id=eq.${vendor_id}`; |
| app\api\admin\wallet\vendor-summary\route.ts.bak.20260122_055949 | const balUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet_balances_v1?vendor_id=eq.${vendor_id}`; |
| app\api\dispatch\assign\assign_route | .from("driver_wallet_balances_v1") |
| app\api\dispatch\assign\route.ts.bak.20251222-032553 | .from("driver_wallet_balances_v1") |
| app\api\dispatch\assign\route.ts.bak.20251222-083111 | .from("driver_wallet_balances_v1") |
| app\api\dispatch\assign\route.ts.bak.20251222-083753 | .from("driver_wallet_balances_v1") |
| app\api\dispatch\assign\route.ts.bak.20251222-094040 | .from("driver_wallet_balances_v1") |
| app\api\dispatch\assign\route.ts.bak.20251225-045838 | .from("driver_wallet_balances_v1") |
| app\api\dispatch\drivers-live\route.ts | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251226-045638 | // Returns: id, driver_status, driver_name, wallet_balance, wallet_locked, min_wallet_required, lat, lng, location_updated_at |
| app\api\dispatch\drivers-live\route.ts.bak.20251226-083518 | // Returns: id, driver_status, driver_name, wallet_balance, wallet_locked, min_wallet_required, lat, lng, location_updated_at |
| app\api\dispatch\drivers-live\route.ts.bak.20251226-234523 | // id, driver_name, driver_status, wallet_balance, min_wallet_required, wallet_locked, lat, lng, location_updated_at |
| app\api\dispatch\drivers-live\route.ts.bak.20251226-235439 | wallet_balance, |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_025811 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_030418 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_030805 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_032051 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_032856 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227_033227 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227-001643 | const walletBal = pickFirst(row, ["wallet_balance", "balance", "wallet", "driver_wallet_balance"]); |
| app\api\dispatch\drivers-live\route.ts.bak.20251227-003335 | const wallet_balance = |
| app\api\dispatch\drivers-live\route.ts.bak.20251227-004340 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\dispatch\drivers-live\route.ts.bak.20251227-013121 | const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null; |
| app\api\driver\payout-request\route.ts | .from("driver_wallet_balances_v1") |
| app\api\driver\payout-request\route.ts.bak.20260113_183632 | .from("driver_wallet_balances_v1") |
| app\api\driver\payout-request\route.ts.bak.20260113_184542 | .from("driver_wallet_balances_v1") |
| app\api\driver\wallet\route.ts.bak.20260125_201152 | .select("id, driver_name, driver_status, wallet_balance, min_wallet_required, wallet_locked") |
| app\api\public\passenger\book\route.ts | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_072320 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_074058 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_075015 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_080245 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_081612 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_085844 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_091742 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20251228_120958 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260102_024719 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260102_025030 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260102_025258 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260102_025609 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260102_030118 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260106_011327 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260106_011605 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260106_012216 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260106_023647 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260108_205114 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260109_032959 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260109_033214 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\book\route.ts.bak.20260123_085122 | const selW = "wallet_balance,min_wallet_required,wallet_locked"; |
| app\api\public\passenger\can-book\route.ts | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20251228_120958 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260102_025030 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260102_030118 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260102_061704 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260102_062244 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260102_062442 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260118_184642 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_021623 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_022055 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_022504 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_023036 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_023442 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_024210 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_024834 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_052756 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_053109 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_053717 | wallet_balance: null as number \| null, |
| app\api\public\passenger\can-book\route.ts.bak.20260204_054434 | wallet_balance: null as number \| null, |
| app\api\takeout\admin\vendor-details\[vendorId]\route.ts | "vendor_id,total_billings,total_platform_fees,total_vendor_earnings,wallet_balance,last_payout_at,last_payout_amount" |
| app\api\takeout\vendor\payout\details\route.ts | "vendor_id,total_billings,total_platform_fees,total_vendor_earnings,wallet_balance,last_payout_at,last_payout_amount" |
| app\api\takeout\vendor\payout\details\route.ts.bak_20251215_022109 | "vendor_id,total_billings,total_platform_fees,total_vendor_earnings,wallet_balance,last_payout_at,last_payout_amount" |
| app\api\takeout\vendor\payout\request\route.ts | .select("wallet_balance") |
| app\api\takeout\vendor\request-payout\route.ts | .select("wallet_balance") |
| app\api\vendor\payout-request\route.ts | .from("vendor_wallet_balances_v1") |
