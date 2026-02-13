$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\bookings\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$bak = "$target.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# --- SANITY: file should contain POST handler and sb.from("bookings").insert( ---
if ($txt -notmatch "export\s+async\s+function\s+POST") { Fail "Could not find POST handler in route.ts" }
if ($txt -notmatch "from\(\s*`"bookings`"\s*\)\.insert") { Fail "Could not find sb.from(""bookings"").insert(...) in route.ts" }

# 1) Ensure auth gate is not inverted (common bug we saw in your snippet)
#    If you have: if (isAllowed(role)) return Forbidden -> flip to if (!isAllowed(role)) return Forbidden
$txt2 = $txt -replace '(?m)^\s*if\s*\(\s*isAllowed\s*\(\s*role\s*\)\s*\)\s*return\s+jsonError\(\s*["'']Forbidden["'']\s*,\s*403\s*\)\s*;\s*$',
                      '  if (!isAllowed(role)) return jsonError("Forbidden", 403);'

$txt = $txt2

# 2) Replace the static insert object with dynamic, schema-safe insert builder.
#    We will:
#    - query ONE row from bookings (select("*").limit(1))
#    - compute allowed columns from returned object keys
#    - build candidate fields from body
#    - filter to allowed columns ONLY
#    - insert(filtered)
#
# Anchor: the POST handler currently contains "const sb = supabaseAdmin();" and then "const insert = { ... };"
# We'll replace from "const sb = supabaseAdmin();" up to the insert+insert call with a safe block.

$rx = '(?s)export\s+async\s+function\s+POST\s*\(\s*req\s*:\s*NextRequest\s*\)\s*\{.*?const\s+sb\s*=\s*supabaseAdmin\(\)\s*;.*?const\s+insert\s*=\s*\{.*?\}\s*;.*?const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+sb\.from\(\s*["'']bookings["'']\s*\)\.insert\(\s*insert\s*\)\.select\(\s*["'']\*["'']\s*\)\.single\(\s*\)\s*;'

if ($txt -notmatch $rx) {
  Fail "Could not locate the expected POST insert block to replace. Paste your POST() from app\api\dispatch\bookings\route.ts."
}

$replacement = @'
export async function POST(req: NextRequest) {

  const __JRIDE_DEV_BYPASS__ = jrideDevBypass(req);
  // JRIDE_DEV_BYPASS_NOTE: localhost dev bypass enabled; auth-gate should not block create in dev.

  const session = await auth();
  const role = (session?.user as any)?.role;
  const email = session?.user?.email || "";

  // If NOT allowed and NOT dev-bypass, forbid.
  if (!isAllowed(role) && !__JRIDE_DEV_BYPASS__) return jsonError("Forbidden", 403);

  let body: any = null;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON"); }

  const sb = supabaseAdmin();

  // --------- Schema-safe insert (DO NOT assume columns exist) ----------
  // Pull one row to learn available columns (schema cache safe)
  const probe = await sb.from("bookings").select("*").limit(1);
  const sample = (probe.data && probe.data[0]) ? probe.data[0] : {};
  const allowed = new Set(Object.keys(sample || {}));

  // Candidates (we filter to allowed keys below)
  const town = String(body.town || "").trim() || null;

  const candidate: any = {
    trip_type: "takeout",
    town: town,
    status: "new",

    // Optional takeout support
    takeout_service_level: (body as any)?.takeout_service_level ?? "regular",
    vendor_id: (body as any)?.vendor_id ?? null,

    // Optional labels/coords/notes/etc (will be dropped if columns don't exist)
    pickup_label: body.pickup_label ?? null,
    dropoff_label: body.dropoff_label ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
    distance_km: body.distance_km ?? null,
    fare: body.fare ?? null,
    notes: body.notes ?? null,
    rider_name: body.rider_name ?? null,
    rider_phone: body.rider_phone ?? null,
    dispatcher_email: email || null,
  };

  // Filter to allowed columns ONLY
  const insert: any = {};
  for (const k of Object.keys(candidate)) {
    if (allowed.has(k)) insert[k] = candidate[k];
  }

  // Minimal requirement: we need at least trip_type/status
  if (!Object.keys(insert).length) return jsonError("No compatible columns found for insert()", 500);

  const { data, error } = await sb.from("bookings").insert(insert).select("*").single();
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ row: data });
}
'@

$txt = [regex]::Replace($txt, $rx, $replacement)

# Sanity: ensure POST still exists and insert call exists
if ($txt -notmatch "export\s+async\s+function\s+POST") { Fail "Sanity failed: POST missing after patch" }
if ($txt -notmatch 'from\("bookings"\)\.insert') { Fail "Sanity failed: bookings insert missing after patch" }

Set-Content -Path $target -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched schema-safe insert in: $target" -ForegroundColor Green
Write-Host "Next: restart dev server, then run the E2E script below." -ForegroundColor Cyan
