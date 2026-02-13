# PATCH-JRIDE_PASSENGER_CAN_BOOK_ONE_DAY_RIDE_V1D.ps1
# ASCII-only. Single patch that:
# 1) Adds resolvePassengerFirstRideUsage() helper if missing
# 2) Injects unverified policy after resolvePassengerVerification()
# No request body assumptions.

$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$FILE = Join-Path $ROOT "app\api\public\passenger\can-book\route.ts"
if (!(Test-Path $FILE)) { throw "Missing file: $FILE" }

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }

# Backup
$bak = "$FILE.bak.$(Stamp)"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $FILE

# Anchors (fail fast)
$must = @("resolvePassengerVerification", "isNightGateNow", "export async function POST", "NextResponse")
foreach ($m in $must) {
  if ($txt -notmatch [regex]::Escape($m)) {
    throw "Anchor missing: $m (not can-book route?)"
  }
}

# 1) Ensure helper exists
if ($txt -notmatch "resolvePassengerFirstRideUsage") {

$helper = @'
async function resolvePassengerFirstRideUsage(supabase: any) {
  // Determine if passenger already used their 1 daytime ride.
  // We do NOT assume schema, so we try multiple possible passenger linkage columns.
  const out = {
    ok: true,
    used: false,
    count: null as number | null,
    note: "",
    source: "none" as "none" | "bookings"
  };

  let userId: string | null = null;
  let email: string | null = null;

  try {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
    email = data?.user?.email ?? null;
  } catch {
    // ignore
  }

  if (!userId && !email) {
    out.note = "No auth user; default allow one daytime ride.";
    return out;
  }

  const statuses = ["pending","assigned","on_the_way","on_trip","completed"];

  const candidates: Array<{ col: string; val: string | null; label: string }> = [
    { col: "passenger_id", val: userId, label: "bookings.passenger_id" },
    { col: "rider_id", val: userId, label: "bookings.rider_id" },
    { col: "user_id", val: userId, label: "bookings.user_id" },
    { col: "auth_user_id", val: userId, label: "bookings.auth_user_id" },
    { col: "passenger_user_id", val: userId, label: "bookings.passenger_user_id" },
    { col: "email", val: email, label: "bookings.email" },
    { col: "passenger_email", val: email, label: "bookings.passenger_email" }
  ];

  for (const c of candidates) {
    if (!c.val) continue;
    try {
      const resp = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq(c.col, c.val)
        .in("status", statuses);

      if (!resp?.error) {
        const cnt = (typeof resp.count === "number") ? resp.count : null;
        out.source = "bookings";
        out.count = cnt;
        out.used = (typeof cnt === "number") ? (cnt >= 1) : false;
        out.note = "Matched " + c.label;
        return out;
      }
    } catch {
      // try next candidate
    }
  }

  out.note = "Could not probe bookings (schema/RLS); default allow one daytime ride.";
  out.used = false;
  return out;
}

'@

  # Insert helper before POST
  $txt2 = [regex]::Replace($txt, "export\s+async\s+function\s+POST", ($helper + "export async function POST"), 1)
  if ($txt2 -eq $txt) { throw "Failed to insert helper before POST()." }
  $txt = $txt2
  Write-Host "[OK] Inserted resolvePassengerFirstRideUsage() helper."
} else {
  Write-Host "[SKIP] resolvePassengerFirstRideUsage() already exists."
}

# 2) Inject policy block if not already applied
if ($txt -match "JRIDE_UNVERIFIED_ONE_DAY_RIDE_V1D") {
  Write-Host "[SKIP] Policy already applied (V1D)."
  Set-Content -Path $FILE -Value $txt -Encoding UTF8
  exit 0
}

# Detect verification assignment statement (full statement ending with semicolon)
$verStmtMatch = [regex]::Match(
  $txt,
  "(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*await\s+resolvePassengerVerification\([^;]*\)\s*;"
)
if (!$verStmtMatch.Success) {
  throw "Could not detect resolvePassengerVerification(...) statement ending with semicolon."
}

$verVar = $verStmtMatch.Groups[1].Value
$verStmt = $verStmtMatch.Value

$policy = @"
  // JRIDE_UNVERIFIED_ONE_DAY_RIDE_V1D
  // Policy:
  // - Unverified: allow ONE daytime ride
  // - Unverified: block at night
  // - After first ride: verification required
  if (!$verVar.verified) {
    const night = isNightGateNow();

    if (night) {
      return NextResponse.json(
        { allowed: false, reason: "UNVERIFIED_NIGHT_BLOCKED", message: "Night bookings require passenger verification." },
        { status: 200 }
      );
    }

    const firstRide = await resolvePassengerFirstRideUsage(supabase);

    if (firstRide.used) {
      return NextResponse.json(
        {
          allowed: false,
          reason: "UNVERIFIED_LIMIT_REACHED",
          message: "You have already used your one daytime ride. Please complete verification to book again.",
          meta: { firstRide }
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        reason: "UNVERIFIED_ONE_DAY_RIDE_ALLOWED",
        message: "You may book one daytime ride. Verification will be required for your next booking.",
        meta: { firstRide }
      },
      { status: 200 }
    );
  }

"@

# Inject immediately after the verification statement
$needle = [regex]::Escape($verStmt)
$txt3 = [regex]::Replace($txt, $needle, ($verStmt + "`r`n" + $policy), 1)

if ($txt3 -eq $txt) {
  throw "Injection failed - file unchanged."
}

Set-Content -Path $FILE -Value $txt3 -Encoding UTF8
Write-Host "[OK] Injected V1D policy block."
Write-Host "[OK] Patched: $FILE"
