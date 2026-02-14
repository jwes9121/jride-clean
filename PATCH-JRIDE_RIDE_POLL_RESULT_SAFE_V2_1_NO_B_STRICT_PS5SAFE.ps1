param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference="Stop"
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: /ride poll safe result (V2.1 STRICT / NO b) (PS5-safe) ==" -ForegroundColor Cyan

$F = Join-Path $ProjRoot "app\ride\page.tsx"
if (-not (Test-Path -LiteralPath $F)) { Fail "[FAIL] Target not found: $F" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("ride.page.tsx.bak.POLL_RESULT_SAFE_V2_1_STRICT.{0}" -f $stamp)
Copy-Item -Force -LiteralPath $F -Destination $bak
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $F -Raw
$before = $txt.Length
Ok ("[OK] Before chars: {0}" -f $before)

# Idempotency
if ($txt.Contains("JRIDE_POLL_RESULT_SAFE_V2_1_BEGIN")) {
  Ok "[OK] V2.1 STRICT already present. No changes."
  exit 0
}

# Remove any previous injected blocks safely (no giant regex)
function RemoveBlock([string]$s, [string]$begin, [string]$end) {
  while ($true) {
    $i = $s.IndexOf($begin)
    if ($i -lt 0) { break }
    $j = $s.IndexOf($end, $i)
    if ($j -lt 0) { break }
    $j2 = $j + $end.Length
    $s = $s.Remove($i, $j2 - $i)
  }
  return $s
}

$txt = RemoveBlock $txt "// JRIDE_GETJSON_RESULT_SAFE_V1_BEGIN" "// JRIDE_GETJSON_RESULT_SAFE_V1_END"
$txt = RemoveBlock $txt "// JRIDE_GETJSON_RESULT_SAFE_V1_1_BEGIN" "// JRIDE_GETJSON_RESULT_SAFE_V1_1_END"
$txt = RemoveBlock $txt "// JRIDE_GETJSON_RESULT_SAFE_V1_2_BEGIN" "// JRIDE_GETJSON_RESULT_SAFE_V1_2_END"
$txt = RemoveBlock $txt "// JRIDE_GETJSON_RESULT_SAFE_V1_3_BEGIN" "// JRIDE_GETJSON_RESULT_SAFE_V1_3_END"
$txt = RemoveBlock $txt "// JRIDE_GETJSON_RESULT_SAFE_V1_4_BEGIN" "// JRIDE_GETJSON_RESULT_SAFE_V1_4_END"
$txt = RemoveBlock $txt "// JRIDE_POLL_RESULT_SAFE_V2_BEGIN" "// JRIDE_POLL_RESULT_SAFE_V2_END"
$txt = RemoveBlock $txt "// JRIDE_POLL_RESULT_SAFE_V2_1_BEGIN" "// JRIDE_POLL_RESULT_SAFE_V2_1_END"

# Ensure helper exists
if (-not ($txt -match 'function\s+jrideSafeText\s*\(')) {
  $helper = @"
function jrideSafeText(x: any, maxLen: number = 300): string {
  try {
    let s = "";
    if (x === null || x === undefined) s = "";
    else if (typeof x === "string") s = x;
    else if (typeof x === "number" || typeof x === "boolean") s = String(x);
    else s = JSON.stringify(x);
    if (!s) return "";
    if (s.length > maxLen) return s.slice(0, maxLen) + "...";
    return s;
  } catch {
    try { return String(x ?? ""); } catch { return ""; }
  }
}
"@
  $useClient = '"use client";'
  $pos = $txt.IndexOf($useClient)
  if ($pos -ge 0) {
    $insertAt = $pos + $useClient.Length
    $txt = $txt.Insert($insertAt, "`r`n`r`n" + $helper + "`r`n")
    Ok "[OK] Inserted jrideSafeText() after use client"
  } else {
    $txt = $helper + "`r`n" + $txt
    Ok "[OK] Inserted jrideSafeText() at top (fallback)"
  }
} else {
  Ok "[OK] jrideSafeText() helper already exists"
}

# Inject after the FIRST exact occurrence of this anchor line
$anchor = "setLiveUpdatedAt(Date.now());"
$k = $txt.IndexOf($anchor)
if ($k -lt 0) { Fail "[FAIL] Anchor not found: setLiveUpdatedAt(Date.now());" }

$inject = @"
`r`n        // JRIDE_POLL_RESULT_SAFE_V2_1_BEGIN
        try {
          const __b: any = (typeof liveBooking !== "undefined") ? (liveBooking as any) : null;
          const __st = (typeof liveStatus !== "undefined" && liveStatus) ? String(liveStatus) : String((__b && (__b.status ?? "")) || "");
          const __fareRaw = (__b && ((__b.proposed_fare ?? __b.verified_fare) ?? null));
          const __fareNum = (typeof __fareRaw === "number") ? __fareRaw : (__fareRaw != null ? Number(__fareRaw) : null);
          const __fare = (__fareNum != null && Number.isFinite(__fareNum)) ? __fareNum : null;

          if (__fare !== null) {
            setResult("Offer received: PHP " + String(Math.round(__fare)) + (__st ? (" (status=" + __st + ")") : ""));
          } else if (__st) {
            setResult("Booking status: " + __st);
          } else {
            setResult("");
          }
        } catch {
          setResult("");
        }
        // JRIDE_POLL_RESULT_SAFE_V2_1_END
"@

# Insert right after the anchor line
$insertPos = $k + $anchor.Length
$txt = $txt.Insert($insertPos, $inject)
Ok "[OK] Injected V2.1 STRICT safe result block after setLiveUpdatedAt(Date.now());"

# Clamp render
$txt = $txt.Replace("{result}", "{jrideSafeText(result, 300)}")
$txt = $txt.Replace("value={result}", "value={jrideSafeText(result, 300)}")
Ok "[OK] Clamped result rendering"

# Size guard: MUST NOT balloon
$after = $txt.Length
Ok ("[OK] After chars:  {0}" -f $after)

# Abort if file grew too much
$maxGrow = 200000   # ~200k chars max increase
if ($after -gt ($before + $maxGrow)) {
  Copy-Item -Force -LiteralPath $bak -Destination $F
  Fail ("[FAIL] Patch caused abnormal growth (+{0} chars). Restored backup." -f ($after - $before))
}

# Also abort if file exceeds 95MB (keep safe below GitHub 100MB)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($F, $txt, $utf8NoBom)

$finalSize = (Get-Item -LiteralPath $F).Length
Ok ("[OK] Final bytes: {0}" -f $finalSize)

if ($finalSize -gt 95000000) {
  Copy-Item -Force -LiteralPath $bak -Destination $F
  Fail "[FAIL] page.tsx would exceed safe push size (>95MB). Restored backup."
}

Ok ("[OK] Wrote: {0}" -f $F)
Write-Host ("Backup: {0}" -f $bak) -ForegroundColor Yellow
Write-Host "NEXT: build -> commit -> tag -> push" -ForegroundColor Cyan
