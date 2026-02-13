# PATCH-JRIDE_VENDOR_ORDERS_PHASE1_POLISH.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak." + (Stamp)
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# --- Fix mojibake from prior encoding issues ---
$txt = $txt.Replace("â‚±", "₱").Replace("·", "·")

# --- PHASE14 vendor flow gating was wrong (included 'ready' but statuses don't) ---
# Replace the VENDOR_FLOW_UI array with the real flow used by this page/actions.
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*const\s+VENDOR_FLOW_UI\s*=\s*\[[^\]]*\]\s*as\s*const\s*;\s*$',
  '  const VENDOR_FLOW_UI = ["preparing","driver_arrived","picked_up","completed"] as const;'
)

# --- Add DEV geo bypass constant (controlled by env var) ---
if($txt -notmatch '(?m)^\s*const\s+DEV_VENDOR_GEO_BYPASS\s*='){
  $txt = [regex]::Replace(
    $txt,
    '(?m)^\s*//\s*UI-only:\s*vendor can view page anywhere, but ACTIONS require location permission \+ inside Ifugao\.\s*$',
@'
  // UI-only: vendor can view page anywhere, but ACTIONS require location permission + inside Ifugao.
  // Dev/test bypass (OFF by default). Set NEXT_PUBLIC_VENDOR_GEO_BYPASS=1 to enable actions anywhere.
  const DEV_VENDOR_GEO_BYPASS = process.env.NEXT_PUBLIC_VENDOR_GEO_BYPASS === "1";
'@
  )
  Write-Host "[OK] Inserted DEV_VENDOR_GEO_BYPASS flag" -ForegroundColor Green
} else {
  Write-Host "[OK] DEV_VENDOR_GEO_BYPASS already present (skipped)" -ForegroundColor DarkGray
}

# --- vendorActionBlocked should honor bypass (and avoid duplicate checks later) ---
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*const\s+vendorActionBlocked\s*=\s*!\(\s*vGeoPermission\s*===\s*"granted"\s*&&\s*vGeoInsideIfugao\s*\)\s*;\s*$',
  '  const vendorActionBlocked = !DEV_VENDOR_GEO_BYPASS && !(vGeoPermission === "granted" && vGeoInsideIfugao);'
)

# --- Repair loadOrders(): it is currently corrupted and not calling setOrders(mapped) properly ---
$loadPattern = '(?s)const\s+loadOrders\s*=\s*async\s*\(\)\s*=>\s*\{.*?\n\s*\};'
if($txt -match $loadPattern){
  $loadReplacement = @'
  const loadOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/vendor-orders", {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load orders (status ${res.status})`);
      }

      const data: { orders: ApiOrder[] } = await res.json();

      const mapped: VendorOrder[] = (data.orders || []).map((o) => ({
        id: o.id,
        bookingCode: o.booking_code,
        customerName: o.customer_name ?? "",
        totalBill: o.total_bill ?? 0,
        status: (o.vendor_status ?? "preparing") as VendorOrderStatus,
        createdAt: o.created_at,
      }));

      // Prevent poll flicker while a status update is in-flight
      if (updatingIdRef.current) return;

      setOrders(mapped);
    } catch (err: any) {
      console.error("[VendorOrders] loadOrders error:", err);
      setError(err?.message || "Failed to load orders.");
    } finally {
      setIsLoading(false);
    }
  };
'@
  $txt = [regex]::Replace($txt, $loadPattern, $loadReplacement)
  Write-Host "[OK] Repaired loadOrders() (restored setOrders(mapped))" -ForegroundColor Green
} else {
  Fail "Could not locate loadOrders() block to repair."
}

# --- Ensure page loads orders on mount (only add if missing) ---
if($txt -notmatch '(?s)useEffect\s*\(\s*\(\)\s*=>\s*\{\s*loadOrders\('){
  $txt = [regex]::Replace(
    $txt,
    '(?s)(const\s+loadOrders\s*=\s*async\s*\(\)\s*=>\s*\{.*?\n\s*\};)',
    "`$1`r`n`r`n  useEffect(() => {`r`n    loadOrders().catch(() => undefined);`r`n    const t = setInterval(() => {`r`n      // Poll every 10s (skips replace while updatingIdRef is set)`r`n      loadOrders().catch(() => undefined);`r`n    }, 10000);`r`n    return () => clearInterval(t);`r`n    // eslint-disable-next-line react-hooks/exhaustive-deps`r`n  }, []);"
  )
  Write-Host "[OK] Added loadOrders() mount + polling effect" -ForegroundColor Green
} else {
  Write-Host "[OK] loadOrders() mount effect already present (skipped)" -ForegroundColor DarkGray
}

# --- Fix status badge label for driver_arrived (used as 'ready' in this UI) ---
$txt = $txt.Replace(">`r`n            Mark ready", ">`r`n            ready")

# --- Remove duplicate vendorActionBlocked checks in disabled props ---
$txt = $txt.Replace("vendorActionBlocked || vendorActionBlocked ||", "vendorActionBlocked ||")

# --- Write UTF-8 NO BOM (prevents mojibake regressions) ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))

Write-Host "[OK] Patched: $target (UTF-8 no BOM)" -ForegroundColor Green
