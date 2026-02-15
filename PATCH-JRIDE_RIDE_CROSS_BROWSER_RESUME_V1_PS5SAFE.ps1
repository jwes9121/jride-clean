param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Say($msg, $color="Cyan") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

Say "== JRIDE Patch: Cross-browser resume active booking + fix garbled offer text (V1 / PS5-safe) =="

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "ProjRoot not found: $ProjRoot" }

$ride = Join-Path $ProjRoot "app\ride\page.tsx"
$api  = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"

if (!(Test-Path -LiteralPath $ride)) { Fail "Missing: $ride" }
if (!(Test-Path -LiteralPath $api))  { Fail "Missing: $api" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"

# ----------------------------
# 1) Patch app/ride/page.tsx
# ----------------------------
$rideBak = Join-Path $bakDir ("ride.page.tsx.bak.CROSS_BROWSER_RESUME_V1.$ts")
Copy-Item -Force $ride $rideBak
Say ("[OK] Backup: {0}" -f $rideBak) "Yellow"

$txt = Get-Content -LiteralPath $ride -Raw

# (A) Fix corrupted hardcoded "Offer received ÃƒÆ’..." spam if present.
# Replace the whole JSX line containing "Offer received Ã" with a clean string.
if ($txt -match 'Offer received\s+Ã') {
  $txt = [regex]::Replace(
    $txt,
    'Offer received\s+Ã[^\r\n<]*',
    'Offer received (fare proposed)'
  )
  Say "[OK] Cleaned corrupted hardcoded offer text" "Green"
} else {
  Say "[OK] No corrupted hardcoded offer text detected" "Green"
}

# (B) Ensure activeCode initializes from localStorage helper, not blank.
# Replace: const [activeCode, setActiveCode] = React.useState<string>("");
# With:    const [activeCode, setActiveCode] = React.useState<string>(() => jrideGetActiveBookingCode());
$patternActiveCode = 'const\s+\[activeCode,\s*setActiveCode\]\s*=\s*React\.useState<string>\(\s*""\s*\)\s*;'
if ($txt -match $patternActiveCode) {
  $txt = [regex]::Replace(
    $txt,
    $patternActiveCode,
    'const [activeCode, setActiveCode] = React.useState<string>(() => jrideGetActiveBookingCode());'
  )
  Say "[OK] activeCode now initializes from jrideGetActiveBookingCode()" "Green"
} else {
  # If it's already correct, that's fine.
  if ($txt -match 'const\s+\[activeCode,\s*setActiveCode\]\s*=\s*React\.useState<string>\(\s*\(\)\s*=>\s*jrideGetActiveBookingCode\(\)\s*\)\s*;') {
    Say "[OK] activeCode already initializes from localStorage helper" "Green"
  } else {
    Say "[WARN] Could not find activeCode initializer to replace (manual check recommended)" "Yellow"
  }
}

# (C) Add cross-browser restore effect:
# On first load, if activeCode is empty, call /api/public/passenger/booking (no code).
# If it returns ok + booking_code, set activeCode + localStorage.
# Anchor: after the local verification load effect block (the one that reads LOCAL_VERIFY_KEY)
$anchor = 'try\s*\{\s*\r?\n\s*const v = window\.localStorage\.getItem\(LOCAL_VERIFY_KEY\);\s*\r?\n\s*if \(v\) setLocalVerify\(String\(v\)\);\s*\r?\n\s*\}\s*catch\s*\{\s*\r?\n\s*\/\/ ignore\s*\r?\n\s*\}\s*'

if ($txt -match $anchor) {
  if ($txt -match 'JRIDE_CROSS_BROWSER_RESUME_V1_BEGIN') {
    Say "[OK] Cross-browser resume effect already present" "Green"
  } else {
    $inject = @'
  // JRIDE_CROSS_BROWSER_RESUME_V1_BEGIN
  React.useEffect(() => {
    // If localStorage is empty (new browser/incognito), try to restore the user's latest active booking.
    // Server will only return something when signed-in and there is an active booking.
    if (activeCode) return;

    let cancelled = false;

    (async () => {
      try {
        const resp = await getJson("/api/public/passenger/booking");
        if (!resp.ok) return;
        const j = resp.json || {};
        const b = (j.booking || j) as any;
        const code = String((b && (b.booking_code || b.code)) || "").trim();
        if (!code) return;
        if (cancelled) return;

        try { jrideSetActiveBookingCode(code); } catch {}
        try { setActiveCode(code); } catch {}
      } catch {
        // ignore (best effort)
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // JRIDE_CROSS_BROWSER_RESUME_V1_END

'@

    # Insert right AFTER the local verify effect (after its closing }, []);
    # We anchor on the localStorage getItem block then insert after the next occurrence of "}, []);"
    $pos = [regex]::Match($txt, $anchor).Index
    if ($pos -lt 0) { Fail "Unexpected: anchor match index < 0" }

    # Find the next "}, []);" after the anchor match
    $tail = $txt.Substring($pos)
    $mClose = [regex]::Match($tail, '\}\s*,\s*\[\s*\]\s*\)\s*;\s*')
    if (!$mClose.Success) {
      Say "[WARN] Could not locate end of local-verify useEffect to inject after; skipping injection" "Yellow"
    } else {
      $insertAt = $pos + $mClose.Index + $mClose.Length
      $txt = $txt.Insert($insertAt, "`r`n$inject")
      Say "[OK] Injected cross-browser resume effect (server fallback)" "Green"
    }
  }
} else {
  Say "[WARN] Could not find local verification effect anchor; skipping resume injection" "Yellow"
}

# (D) Safety: remove any accidental "activeBookingCode" state block if present (it was unused noise)
$txt = [regex]::Replace(
  $txt,
  '\r?\n\s*const\s+\[activeBookingCode,\s*setActiveBookingCode\]\s*=\s*React\.useState<string>\(\s*\(\)\s*=>\s*jrideGetActiveBookingCode\(\)\s*\)\s*;\s*\r?\n',
  "`r`n"
)

Set-Content -LiteralPath $ride -Value $txt -Encoding UTF8
Say ("[OK] Wrote: {0}" -f $ride) "Green"

# ----------------------------
# 2) Patch app/api/public/passenger/booking/route.ts
# ----------------------------
$apiBak = Join-Path $bakDir ("public-passenger-booking.route.ts.bak.CROSS_BROWSER_RESUME_V1.$ts")
Copy-Item -Force $api $apiBak
Say ("[OK] Backup: {0}" -f $apiBak) "Yellow"

$atxt = Get-Content -LiteralPath $api -Raw

# We replace the existing:
# if (!bookingCode) { return json(400, ... ) }
# with:
# if (!bookingCode) { if signed in -> find latest active booking by created_by_user_id and active statuses }
# Uses select("*") to avoid assuming columns.
$blockPattern = 'if\s*\(\s*!\s*bookingCode\s*\)\s*\{\s*[\s\S]*?\}\s*'

# But ONLY replace the first occurrence AFTER bookingCode is defined.
# Anchor: "const bookingCode" line
$anchorBC = 'const\s+bookingCode\s*=\s*String\([^\)]*\)\.trim\(\)\s*;'
$mBC = [regex]::Match($atxt, $anchorBC)
if (!$mBC.Success) {
  Say "[WARN] Could not find bookingCode definition anchor in route.ts; skipping API patch" "Yellow"
} else {
  $afterBC = $atxt.Substring($mBC.Index + $mBC.Length)
  $mBlock = [regex]::Match($afterBC, $blockPattern)
  if (!$mBlock.Success) {
    Say "[WARN] Could not find if(!bookingCode){...} block after bookingCode; skipping API patch" "Yellow"
  } else {
    $old = $mBlock.Value

    if ($old -match 'JRIDE_ACTIVE_BOOKING_FALLBACK_V1_BEGIN') {
      Say "[OK] API fallback already present" "Green"
    } else {
      $new = @'
if (!bookingCode) {
        // JRIDE_ACTIVE_BOOKING_FALLBACK_V1_BEGIN
        // If no code is provided, try to return the signed-in user's latest ACTIVE booking.
        // This enables cross-browser restore when localStorage is empty.
        try {
          const { data: u } = await supabase.auth.getUser();
          const user = u?.user;
          if (!user) {
            return json(401, {
              ok: false,
              code: "UNAUTH",
              message: "Not signed in",
              signed_in: false,
            });
          }

          const ACTIVE = [
            "requested",
            "searching",
            "assigned",
            "driver_assigned",
            "driver_proposed",
            "fare_proposed",
            "awaiting_fare",
            "accepted",
            "to_pickup",
            "arrived_pickup",
            "in_trip",
          ];

          const { data: b2, error: e2 } = await supabase
            .from("bookings")
            .select("*")
            .eq("created_by_user_id", user.id)
            .in("status", ACTIVE)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (e2) {
            return json(500, {
              ok: false,
              code: "DB_ERROR",
              message: e2.message || "DB error",
              signed_in: true,
            });
          }

          if (!b2) {
            return json(404, {
              ok: false,
              code: "NOT_FOUND",
              message: "No active booking",
              signed_in: true,
            });
          }

          return json(200, {
            ok: true,
            signed_in: true,
            booking: b2,
          });
        } catch (e: any) {
          return json(500, {
            ok: false,
            code: "SERVER_ERROR",
            message: String(e?.message || e),
            signed_in: false,
          });
        }
        // JRIDE_ACTIVE_BOOKING_FALLBACK_V1_END
      }
'@

      # Replace only that matched block in $afterBC region
      $before = $atxt.Substring(0, $mBC.Index + $mBC.Length)
      $restBeforeBlock = $afterBC.Substring(0, $mBlock.Index)
      $restAfterBlock  = $afterBC.Substring($mBlock.Index + $mBlock.Length)
      $atxt = $before + $restBeforeBlock + $new + $restAfterBlock

      Set-Content -LiteralPath $api -Value $atxt -Encoding UTF8
      Say "[OK] Patched booking route: supports no-code lookup for latest active booking" "Green"
    }
  }
}

Say ""
Say "NEXT:" "Cyan"
Say "1) Commit + push (this forces Vercel redeploy)" "Cyan"
Say "2) Hard refresh /ride (Ctrl+Shift+R) in Firefox/incognito" "Cyan"
Say "3) Expect: it should auto-resume your active booking without manual localStorage setItem" "Cyan"

Say ""
Say ("Backups:`n- {0}`n- {1}" -f $rideBak, $apiBak) "Yellow"
