# FIX-JRIDE_PHASE13B_GEO_ENFORCE_RIDES_POST_AFTER_JSON_V3.ps1
# ASCII-only. UTF8 NO BOM.
# Restores latest route.ts.bak.* then injects Ifugao geo guard right after request JSON is parsed.
# Does NOT depend on .from("bookings") existing.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadText($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [System.IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($p,$t,$enc) }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\rides\route.ts"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

# 1) Restore latest .bak.*
$dir = Split-Path -Parent $target
$baks = Get-ChildItem -LiteralPath $dir -Filter "route.ts.bak.*" -File | Sort-Object LastWriteTime -Descending
if(!$baks -or $baks.Count -eq 0){ Fail "No backups found next to $target (expected route.ts.bak.YYYYMMDD_HHMMSS)" }
$latestBak = $baks[0].FullName
Copy-Item -Force $latestBak $target
Write-Host "[OK] Restored: $latestBak"
Write-Host "  -> $target"

# Checkpoint
$restoreBak = "$target.restore.$(Timestamp)"
Copy-Item -Force $target $restoreBak
Write-Host "[OK] Restore checkpoint: $restoreBak"

$txt = ReadText $target
$orig = $txt

# 2) Add helper once (after first import line)
if($txt -notmatch 'function\s+insideIfugao\s*\('){
  $mImp = [regex]::Match($txt, '(?m)^import .+?;\s*$')
  if(-not $mImp.Success){ Fail "ANCHOR NOT FOUND: could not find an import line." }
  $pos = $mImp.Index + $mImp.Length

  $helper = @'

function asNum(v: any): number | null {
  const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

// Ifugao bounding box (server-side hard gate).
const IFUGAO_LAT_MIN = 16.60;
const IFUGAO_LAT_MAX = 17.25;
const IFUGAO_LNG_MIN = 120.70;
const IFUGAO_LNG_MAX = 121.35;

function insideIfugao(latAny: any, lngAny: any): boolean {
  const lat = asNum(latAny);
  const lng = asNum(lngAny);
  if (lat == null || lng == null) return false;
  return lat >= IFUGAO_LAT_MIN && lat <= IFUGAO_LAT_MAX && lng >= IFUGAO_LNG_MIN && lng <= IFUGAO_LNG_MAX;
}

function json403(code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

'@

  $txt = $txt.Substring(0,$pos) + $helper + $txt.Substring($pos)
  Write-Host "[OK] Added insideIfugao() helper + json403()."
}

# 3) Inject guard right after: const <var> = await <req>.json(...);
if($txt -match 'JRIDE_GEO_ENFORCE_IFUGAO_BEGIN'){
  Write-Host "[SKIP] Geo enforcement already injected."
} else {
  $rxBody = [regex]::new('(?m)^\s*const\s+([A-Za-z_]\w*)\s*=\s*await\s+([A-Za-z_]\w*)\.json\(\)[^;]*;\s*$', 'Singleline')
  $mBody = $rxBody.Match($txt)
  if(-not $mBody.Success){
    Fail "ANCHOR NOT FOUND: Could not find a line like 'const body = await req.json();' in rides route."
  }

  $bodyVar = $mBody.Groups[1].Value

  $guard = @"

  // ===== JRIDE_GEO_ENFORCE_IFUGAO_BEGIN =====
  // Server-authoritative: block ride creation outside Ifugao.
  const __latAny = ($bodyVar as any)?.pickup_lat ?? ($bodyVar as any)?.pickupLat;
  const __lngAny = ($bodyVar as any)?.pickup_lng ?? ($bodyVar as any)?.pickupLng;
  if (!insideIfugao(__latAny, __lngAny)) {
    return json403("OUTSIDE_IFUGAO", "Booking is only available inside Ifugao.");
  }
  // ===== JRIDE_GEO_ENFORCE_IFUGAO_END =====

"@

  # Insert immediately after the matched body-parse line
  $insertPos = $mBody.Index + $mBody.Length
  $txt = $txt.Substring(0,$insertPos) + $guard + $txt.Substring($insertPos)
  Write-Host "[OK] Injected geo gate after request JSON parse (var: $bodyVar)."
}

if($txt -eq $orig){ Fail "No changes made (unexpected)." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
