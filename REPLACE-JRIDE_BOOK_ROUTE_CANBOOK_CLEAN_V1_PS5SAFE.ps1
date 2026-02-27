param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$rel = "app\api\public\passenger\book\route.ts"
$path = Join-Path $ProjRoot $rel
if (!(Test-Path $path)) { throw "File not found: $path" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak.BOOK_CANBOOK_CLEAN_V1.$ts")
Copy-Item -LiteralPath $path -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $path -Raw

# We replace from "async function canBookOrThrow" up to the marker that follows it.
$marker = "/* FREE_RIDE_PROMO_HELPERS_BEGIN */"
if ($src -notmatch [regex]::Escape($marker)) {
  throw "Could not find marker '$marker' after canBookOrThrow(). Refusing to patch."
}

$pattern = "(?s)async function canBookOrThrow\([^)]*\)\s*\{.*?\n\}\s*\n\s*" + [regex]::Escape($marker)
if ($src -notmatch $pattern) {
  throw "Could not locate canBookOrThrow() block with the expected structure. Refusing to patch."
}

$replacement = @"
async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const out: any = { ok: true };

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    out.ok = false;
    out.status = 401;
    out.code = "NOT_AUTHED";
    out.message = "Not signed in.";
    throw out;
  }

  const userId = user.id;
  const email = user.email ?? null;

  // Single source of truth: VERIFIED if passenger_verifications.status indicates approval
  let verified = false;

  // 1) passenger_verifications (current)
  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    const s = String((pv.data as any)?.status ?? "").toLowerCase().trim();
    if (s === "approved_admin" || s === "approved" || s === "verified") {
      verified = true;
    }
  } catch {}

  // 2) passenger_verification_requests (legacy / dispatcher queue)
  if (!verified) {
    try {
      const pr = await supabase
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", userId)
        .maybeSingle();

      const s = String((pr.data as any)?.status ?? "").toLowerCase().trim();
      if (s === "approved_admin" || s === "approved" || s === "verified") {
        verified = true;
      }
    } catch {}
  }

  // 3) passengers table (legacy flags) - best effort only
  if (!verified) {
    try {
      const selV = "is_verified,verified,verification_tier";
      $tries = @(
        @("auth_user_id", $userId),
        @("user_id", $userId),
        @("email", $email)
      );

      foreach ($t in $tries) {
        $col = $t[0]
        $val = $t[1]
        if ([string]::IsNullOrWhiteSpace([string]$val)) { continue }

        $r = await supabase.from("passengers").select(selV).eq($col, $val).limit(1).maybeSingle();
        if (-not $r.error -and $r.data) {
          $row = $r.data
          $truthy = {
            param($v)
            if ($v -eq $true) { return $true }
            if ($v -is [string]) {
              $s2 = $v.Trim().ToLower()
              return ($s2 -ne "" -and $s2 -ne "false" -and $s2 -ne "0" -and $s2 -ne "no")
            }
            if ($v -is [int] -or $v -is [double] -or $v -is [decimal]) { return ($v -gt 0) }
            return $false
          }

          if (& $truthy $row.is_verified) { $verified = $true; break }
          if (& $truthy $row.verified) { $verified = $true; break }
          if (& $truthy $row.verification_tier) { $verified = $true; break }
        }
      }
    } catch {}
  }

  // Enforce night gate ONLY when not verified, unless explicit bypass headers are present
  if ($nightGate -and (-not $verified) -and (-not (jrideNightGateBypass()))) {
    out.ok = false;
    out.status = 403;
    out.code = "NIGHT_GATE_UNVERIFIED";
    out.message = "Booking is restricted from 8PM to 5AM unless verified.";
    throw out;
  }

  return true;
}

$marker
"@

# NOTE: We used some PS-style variables above by mistake if we insert directly into TS.
# So we must generate TS code, not PowerShell code. Fix: create TS replacement without PS foreach/vars.

$replacement = @"
async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const out: any = { ok: true };

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    out.ok = false;
    out.status = 401;
    out.code = "NOT_AUTHED";
    out.message = "Not signed in.";
    throw out;
  }

  const userId = user.id;
  const email = user.email ?? null;

  // Single source of truth: VERIFIED if passenger_verifications.status indicates approval
  let verified = false;

  // 1) passenger_verifications (current)
  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    const s = String((pv.data as any)?.status ?? "").toLowerCase().trim();
    if (s === "approved_admin" || s === "approved" || s === "verified") {
      verified = true;
    }
  } catch {}

  // 2) passenger_verification_requests (legacy / dispatcher queue)
  if (!verified) {
    try {
      const pr = await supabase
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", userId)
        .maybeSingle();

      const s = String((pr.data as any)?.status ?? "").toLowerCase().trim();
      if (s === "approved_admin" || s === "approved" || s === "verified") {
        verified = true;
      }
    } catch {}
  }

  // 3) passengers table (legacy flags) - best effort only
  if (!verified) {
    try {
      const selV = "is_verified,verified,verification_tier";
      const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
        ["auth_user_id", userId],
        ["user_id", userId],
        ["email", email],
      ];

      const truthy = (v: any) =>
        v === true ||
        (typeof v === "string" && v.trim().toLowerCase() !== "" && v.trim().toLowerCase() !== "false" && v.trim().toLowerCase() !== "0" && v.trim().toLowerCase() !== "no") ||
        (typeof v === "number" && v > 0);

      for (const [col, val] of tries) {
        if (!val) continue;
        const r = await supabase.from("passengers").select(selV).eq(col, val).limit(1).maybeSingle();
        if (!r.error && r.data) {
          const row: any = r.data;
          verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
          if (verified) break;
        }
      }
    } catch {}
  }

  // Enforce night gate ONLY when not verified, unless explicit bypass headers are present
  if (nightGate && !verified && !jrideNightGateBypass()) {
    out.ok = false;
    out.status = 403;
    out.code = "NIGHT_GATE_UNVERIFIED";
    out.message = "Booking is restricted from 8PM to 5AM unless verified.";
    throw out;
  }

  return true;
}

$marker
"@

$out = [regex]::Replace($src, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)

WriteUtf8NoBom $path $out
Write-Host "[OK] Patched: $path"
Write-Host "[INFO] canBookOrThrow() replaced with clean verified alignment logic."