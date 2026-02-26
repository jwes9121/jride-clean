param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function NowStamp { Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $root "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

# Backup
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.bak.REPLACE_GET_V1." + (NowStamp))
Copy-Item -LiteralPath $target -Destination $bak -Force

$src = Get-Content -LiteralPath $target -Raw

# Sanity: must contain both GET and POST exports
if ($src -notmatch 'export\s+async\s+function\s+GET\s*\(\s*req\s*:\s*Request\s*\)\s*\{') {
  throw "Could not find GET(req: Request) handler in $target"
}
if ($src -notmatch 'export\s+async\s+function\s+POST\s*\(\s*req\s*:\s*Request\s*\)\s*\{') {
  throw "Could not find POST(req: Request) handler in $target"
}

# Replace GET block only: from GET signature to just before POST signature
$pattern = 'export\s+async\s+function\s+GET\s*\(\s*req\s*:\s*Request\s*\)\s*\{[\s\S]*?(?=export\s+async\s+function\s+POST\s*\(\s*req\s*:\s*Request\s*\)\s*\{)'

$newGet = @'
export async function GET(req: Request) {
  const supabase = createClient();

  // Admin/session gate (GET has no body; do NOT attempt driver device-lock here)
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();

  let actorUserId: string | null = null;

  if (!allowUnauth && !(wantSecret && gotSecret && gotSecret === wantSecret)) {
    try {
      const { data } = await supabase.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    if (!actorUserId) {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }

  try {
    const url = new URL(req.url);
    const bookingId = (url.searchParams.get("booking_id") || url.searchParams.get("id") || "").trim();
    const bookingCode = (url.searchParams.get("booking_code") || url.searchParams.get("code") || "").trim();

    if (!bookingId && !bookingCode) {
      return jsonErr("BAD_REQUEST", "booking_id or booking_code is required", 400);
    }

    let q: any = supabase
      .from("bookings")
      .select("id, booking_code, status, assigned_driver_id, driver_id, updated_at, proposed_fare, passenger_fare_response, verified_fare, verified_at, verified_by")
      .limit(1);

    if (bookingId) q = q.eq("id", bookingId);
    else q = q.eq("booking_code", bookingCode);

    const r: any = await q.order("updated_at", { ascending: false, nullsFirst: false }).maybeSingle();
    if (r?.error) {
      return jsonErr("DB_ERROR", String(r.error.message || "query failed"), 500);
    }
    if (!r?.data) {
      return jsonErr("NOT_FOUND", "Booking not found", 404);
    }

    return jsonOk({ booking: r.data });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", String(e?.message || e), 500);
  }
}

'@

$rx = New-Object System.Text.RegularExpressions.Regex(
  $pattern,
  ([System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)
)

$before = $src
$after = $rx.Replace($src, $newGet, 1)

if ($after -eq $before) {
  throw "Patch failed: could not replace GET block (pattern mismatch)."
}

# Final sanity: ensure one GET and one POST signature remain
if (($after | Select-String -Pattern 'export\s+async\s+function\s+GET' -AllMatches).Matches.Count -ne 1) {
  throw "Sanity failed: expected exactly one GET export after patch."
}
if (($after | Select-String -Pattern 'export\s+async\s+function\s+POST' -AllMatches).Matches.Count -lt 1) {
  throw "Sanity failed: POST export missing after patch."
}

Set-Content -LiteralPath $target -Value $after -Encoding UTF8

Write-Host "== JRIDE Patch: dispatch/status REPLACE GET handler (V1 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host "[OK] Backup:  $bak" -ForegroundColor Green
Write-Host "[OK] Patched: $target" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: build" -ForegroundColor Cyan
Write-Host "  npm.cmd run build"