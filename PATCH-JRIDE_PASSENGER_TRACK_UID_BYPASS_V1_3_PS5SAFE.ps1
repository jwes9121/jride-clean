param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
Write-Host "== PATCH JRIDE Passenger Track UID bypass (V1.3 / PS5-safe) =="

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }

if (!(Test-Path $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$root = $ProjRoot.TrimEnd("\","/")

# Prefer exact source path
$path = "$root\app\api\passenger\track\route.ts"
if (!(Test-Path -LiteralPath $path)) {
  $alt = "$root\app\api\public\passenger\track\route.ts"
  if (Test-Path -LiteralPath $alt) { $path = $alt } else {
    Fail "[FAIL] Could not find source route.ts at app\api\passenger\track\route.ts or app\api\public\passenger\track\route.ts"
  }
}

Ok "[OK] Target (SOURCE): $path"

$raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8

if ($raw -match "JRIDE_TRACK_UID_BYPASS_BEGIN") {
  Ok "[OK] Patch already applied. No changes."
  exit 0
}

# Detect GET param identifier: export async function GET(<paramName>
$rxGet = [regex]'export\s+async\s+function\s+GET\s*\(\s*([A-Za-z_]\w*)'
$m = $rxGet.Match($raw)
if (-not $m.Success) {
  Fail "[FAIL] Could not detect GET(...) handler param name. Paste the file header around GET(...) and I will patch with exact anchors."
}
$reqName = $m.Groups[1].Value
Ok "[OK] Detected GET param: $reqName"

# We require supabase variable exists (your route uses supabase client)
if ($raw -notmatch "\bsupabase\b") { Fail "[FAIL] 'supabase' variable not detected in source. Different implementation? Paste file." }
if ($raw -notmatch "NextResponse") { Fail "[FAIL] 'NextResponse' not detected. Different implementation? Paste file." }

$markerBegin = "`n// JRIDE_TRACK_UID_BYPASS_BEGIN`n"
$markerEnd   = "`n// JRIDE_TRACK_UID_BYPASS_END`n"

# Injection (uses detected reqName and re-reads code from URL)
$insertion = @"
$markerBegin
  // TEMP TEST BYPASS:
  // If server session is missing but uid is provided, allow tracking ONLY when uid matches created_by_user_id.
  // Usage: /ride/track?code=BOOKING_CODE&uid=PASSENGER_UUID
  try {
    const url2 = new URL($reqName.url);
    const code2 = (url2.searchParams.get("code") || url2.searchParams.get("booking_code") || "").trim();
    const uid = (url2.searchParams.get("uid") || "").trim();
    const uidOk = /^[0-9a-fA-F-]{36}$/.test(uid);

    if (code2 && uidOk) {
      const { data: row2, error: err2 } = await supabase
        .from("bookings")
        .select("*")
        .eq("booking_code", code2)
        .limit(1)
        .maybeSingle();

      if (!err2 && row2 && String((row2 as any).created_by_user_id || "") === uid) {
        return NextResponse.json(row2, { status: 200 });
      }
    }
  } catch (e) {
    // ignore bypass errors
  }
$markerEnd
"@

# Anchor patterns (try strongest -> weaker)
$patterns = @(
  # 1) 404 return containing "Booking not found"
  '(?s)return\s+NextResponse\.json\(\s*\{[^}]*Booking not found[^}]*\}\s*,\s*\{\s*status\s*:\s*404\s*\}\s*\)\s*;',
  # 2) 404 return containing "not found"
  '(?s)return\s+NextResponse\.json\(\s*\{[^}]*not\s+found[^}]*\}\s*,\s*\{\s*status\s*:\s*404\s*\}\s*\)\s*;'
)

$patternUsed = $null
foreach ($p in $patterns) {
  if ($raw -match $p) { $patternUsed = $p; break }
}
if (-not $patternUsed) {
  Fail "[FAIL] Could not locate a 404 NextResponse.json({...not found...},{status:404}) return to anchor. Paste the 404 block from route.ts and I will generate an exact anchor."
}

# Backup
$bakDir = "$root\_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$bakDir\passenger-track.route.ts.bak.UID_BYPASS_V1_3.$stamp"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

# Inject bypass right before the anchored 404 return
$patched = [regex]::Replace($raw, $patternUsed, ($insertion + "`n  " + '$0'), 1)

Set-Content -LiteralPath $path -Value $patched -Encoding UTF8
Ok "[OK] Applied UID bypass patch (SOURCE, V1.3)."

Ok "`nNEXT: rebuild + redeploy, then test:"
Ok "  https://app.jride.net/ride/track?code=TST-AUTOASSIGN-202602162204453&uid=f62080c7-e110-428c-932b-5484a361d5a3"
