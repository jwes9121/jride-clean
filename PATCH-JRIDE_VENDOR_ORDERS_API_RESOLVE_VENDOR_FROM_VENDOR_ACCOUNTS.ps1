# PATCH-JRIDE_VENDOR_ORDERS_API_RESOLVE_VENDOR_FROM_VENDOR_ACCOUNTS.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\api\vendor-orders\route.ts"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# --- 1) Insert helper before the GET handler marker ---
$marker = "`n// GET /api/vendor-orders"
$idx = $txt.IndexOf($marker)
if($idx -lt 0){
  $marker = "`n// GET  /api/vendor-orders"
  $idx = $txt.IndexOf($marker)
}
if($idx -lt 0){
  $marker = "`n// GET /api/vendor-orders?"
  $idx = $txt.IndexOf($marker)
}
if($idx -lt 0){
  $marker = "`nexport async function GET"
  $idx = $txt.IndexOf($marker)
}
if($idx -lt 0){ Fail "Could not locate GET handler marker in route.ts" }

if($txt -match "resolveVendorIdFromVendorAccounts"){ Fail "Helper already exists. Aborting." }

$helper = @"
async function resolveVendorIdFromVendorAccounts(args: { email?: string | null; userId?: string | null }) {
  const email = (args.email || "").trim();
  const userId = (args.userId || "").trim();

  const admin = getServiceRoleAdmin();
  if (!admin) return null;

  // Try common column names defensively; ignore column-not-found errors
  const vendorIdCols = ["vendor_id", "vendorId", "vendor_uuid", "vendor_uuid_id", "vendor"];
  const emailCols = ["email", "vendor_email", "account_email"];
  const userIdCols = ["user_id", "auth_user_id", "owner_user_id", "uid"];

  async function tryLookup(filterCol: string, filterVal: string) {
    if (!filterVal) return null;
    for (const vcol of vendorIdCols) {
      try {
        const { data, error } = await admin
          .from("vendor_accounts")
          .select(vcol)
          .eq(filterCol, filterVal)
          .limit(1)
          .maybeSingle();

        if (error) {
          const msg = String(error.message || "").toLowerCase();
          if (msg.includes("does not exist") || msg.includes("column")) continue;
          continue;
        }

        const val = (data as any)?.[vcol];
        if (val) return String(val);
      } catch {
        // ignore
      }
    }
    return null;
  }

  // 1) Prefer userId match if present
  if (userId) {
    for (const col of userIdCols) {
      const found = await tryLookup(col, userId);
      if (found) return found;
    }
  }

  // 2) Fallback to email match
  if (email) {
    for (const col of emailCols) {
      const found = await tryLookup(col, email);
      if (found) return found;
    }
  }

  return null;
}

"@

$txt = $txt.Insert($idx, "`n" + $helper + "`n")
Write-Host "[OK] Inserted resolveVendorIdFromVendorAccounts()" -ForegroundColor Green

# --- 2) Patch GET vendor_id parsing line (convert const -> let + resolver) ---
$pattern = 'const\s+vendor_id\s*=\s*String\(\s*req\.nextUrl\.searchParams\.get\("vendor_id"\)\s*\|\|\s*req\.nextUrl\.searchParams\.get\("vendorId"\)\s*\|\|\s*""\s*\)\.trim\(\);\s*'
if($txt -notmatch $pattern){
  Fail "Could not find vendor_id parsing line in GET(). Paste the GET() section if modified."
}

$replacement = @"
  // Accept both vendor_id and vendorId (for safety)
  let vendor_id =
    String(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId") || "").trim();

  // If missing, resolve vendor_id from NextAuth session via vendor_accounts (service role)
  if (!vendor_id) {
    let sess: any = null;
    try { sess = await auth(); } catch { sess = null; }

    const email = String(sess?.user?.email || "").trim();

    // Also attempt to get Supabase auth user id (if present)
    let userId = "";
    try {
      const u = await supabase.auth.getUser();
      userId = String(u?.data?.user?.id || "").trim();
    } catch { userId = ""; }

    const resolved = await resolveVendorIdFromVendorAccounts({ email, userId });
    if (resolved) vendor_id = resolved;
  }

"@

$txt = [regex]::Replace($txt, $pattern, $replacement, 1)
Write-Host "[OK] Updated GET() vendor_id resolution (query -> session -> vendor_accounts)" -ForegroundColor Green

# --- 3) Write UTF-8 NO BOM ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))
Write-Host "[OK] Wrote UTF-8 no BOM + patched route.ts" -ForegroundColor Green