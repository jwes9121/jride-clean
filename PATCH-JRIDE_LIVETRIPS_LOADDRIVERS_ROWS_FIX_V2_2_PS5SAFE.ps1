param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE LiveTrips: loadDrivers rows+dropdown-fix (V2.2 / substring / PS5-safe) =="

if (-not (Test-Path -LiteralPath $ProjRoot)) {
  Fail ("[FAIL] ProjRoot does not exist: {0}" -f $ProjRoot)
}

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail ("[FAIL] Target not found: {0}" -f $target)
}

# --- Read bytes, strip UTF-8 BOM if present, decode UTF-8 ---
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($target)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $bytes = $bytes[3..($bytes.Length-1)]
}
$encUtf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = $encUtf8NoBom.GetString($bytes)

# --- Backup ---
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (-not (Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakPath = Join-Path $bakDir ("LiveTripsClient.tsx.bak.LOADDRIVERS_ROWS_FIX_V2_2.{0}" -f $stamp)
[System.IO.File]::WriteAllText($bakPath, $text, $encUtf8NoBom)
Ok ("[OK] Backup: {0}" -f $bakPath)

# --- Locate loadDrivers by substring (handles "}async function loadDrivers" etc.) ---
$idx = $text.IndexOf("async function loadDrivers")
if ($idx -lt 0) { $idx = $text.IndexOf("function loadDrivers") }
if ($idx -lt 0) {
  Fail "[FAIL] Could not find 'function loadDrivers' (async or non-async) in LiveTripsClient.tsx."
}

# Try to include preceding newline indentation, but don't require it
$startIdx = $idx

# Find opening brace '{' after the signature
$braceOpen = $text.IndexOf("{", $idx)
if ($braceOpen -lt 0) {
  Fail "[FAIL] Found loadDrivers signature but could not find opening '{'."
}

# --- Brace scanner (char-code; quote/comment aware) ---
$len = $text.Length
$i = $braceOpen
$depth = 0

$inS = $false
$inD = $false
$inT = $false
$inLine = $false
$inBlock = $false
$escape = $false

$C_LF = 10
$C_BS = 92
$C_SQ = 39
$C_DQ = 34
$C_BT = 96
$C_SL = 47
$C_ST = 42
$C_LB = 123
$C_RB = 125

$braceClose = -1

while ($i -lt $len) {
  $c = [int][char]$text[$i]

  if ($inLine) {
    if ($c -eq $C_LF) { $inLine = $false }
    $i++; continue
  }

  if ($inBlock) {
    if ($c -eq $C_ST -and ($i + 1) -lt $len) {
      $c2 = [int][char]$text[$i+1]
      if ($c2 -eq $C_SL) { $inBlock = $false; $i += 2; continue }
    }
    $i++; continue
  }

  if ($inS -or $inD -or $inT) {
    if ($escape) { $escape = $false; $i++; continue }
    if ($c -eq $C_BS) { $escape = $true; $i++; continue }

    if ($inS -and $c -eq $C_SQ) { $inS = $false; $i++; continue }
    if ($inD -and $c -eq $C_DQ) { $inD = $false; $i++; continue }
    if ($inT -and $c -eq $C_BT) { $inT = $false; $i++; continue }

    $i++; continue
  }

  if ($c -eq $C_SL -and ($i + 1) -lt $len) {
    $c2 = [int][char]$text[$i+1]
    if ($c2 -eq $C_SL) { $inLine = $true; $i += 2; continue }
    if ($c2 -eq $C_ST) { $inBlock = $true; $i += 2; continue }
  }

  if ($c -eq $C_SQ) { $inS = $true; $i++; continue }
  if ($c -eq $C_DQ) { $inD = $true; $i++; continue }
  if ($c -eq $C_BT) { $inT = $true; $i++; continue }

  if ($c -eq $C_LB) { $depth++ }
  elseif ($c -eq $C_RB) {
    $depth--
    if ($depth -eq 0) { $braceClose = $i; break }
  }

  $i++
}

if ($braceClose -lt 0) {
  Fail "[FAIL] Could not find matching closing '}' for loadDrivers block."
}

$before = $text.Substring(0, $startIdx)
$after  = $text.Substring($braceClose + 1)

# --- Replacement function ---
# Single-quoted here-string so PowerShell never expands ${url} etc.
$replacement = @'
async function loadDrivers() {
  // Goal:
  // 1) support backend shape: { ok:true, rows:[...] }
  // 2) avoid the "safeArray(...) || safeArray(...)" always-picks-[] bug
  // 3) make dropdown usable even if API rows have no real names:
  //    - force id = driver UUID
  //    - force name fallback

  const endpoints = [
    "/api/admin/driver_locations",
    "/api/admin/driver-locations",
    "/api/admin/drivers",
    // legacy / optional (keep last)
    "/api/driver-locations",
    "/api/driver_locations",
  ];

  const firstNonEmptyArray = (j: any, keys: string[]) => {
    for (const k of keys) {
      const arr = safeArray<any>(j?.[k]);
      if (arr.length) return arr;
    }
    if (Array.isArray(j) && j.length) return j;
    return [];
  };

  const shortId = (s: any) => {
    const t = String(s || "");
    return t.length > 8 ? t.slice(0, 8) : t;
  };

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;

      const j: any = await r.json().catch(() => ({}));

      const raw = firstNonEmptyArray(j, ["rows", "drivers", "data", "items", "result", "list"]);
      if (!raw.length) continue;

      // normalize, then cast to any to avoid TS excess-property issues
      const normalized = raw.map((d: any) => {
        const driverUuid =
          d?.driver_id ??
          d?.driver_uuid ??
          d?.driverId ??
          d?.id ??
          null;

        const name =
          d?.name ??
          d?.driver_name ??
          d?.driverName ??
          d?.full_name ??
          (driverUuid ? `Driver ${shortId(driverUuid)}` : "Driver");

        return {
          // many dropdowns expect "id"
          id: driverUuid,

          // keep existing DriverRow keys
          driver_id: driverUuid,
          name,
          phone: d?.phone ?? d?.driver_phone ?? d?.driverPhone ?? d?.mobile ?? null,
          town: d?.town ?? d?.zone ?? d?.zone_name ?? d?.municipality ?? null,
          status: d?.status ?? d?.driver_status ?? d?.driverStatus ?? null,
          lat:
            (typeof d?.lat === "number" ? d.lat : Number(d?.lat)) ||
            (typeof d?.latitude === "number" ? d.latitude : Number(d?.latitude)) ||
            (typeof d?.driver_lat === "number" ? d.driver_lat : Number(d?.driver_lat)) ||
            null,
          lng:
            (typeof d?.lng === "number" ? d.lng : Number(d?.lng)) ||
            (typeof d?.longitude === "number" ? d.longitude : Number(d?.longitude)) ||
            (typeof d?.driver_lng === "number" ? d.driver_lng : Number(d?.driver_lng)) ||
            null,
          updated_at: d?.updated_at ?? d?.last_seen_at ?? d?.driver_last_seen_at ?? null,
        };
      });

      const filtered = normalized.filter((x: any) => String(x?.driver_id || x?.id || "").length > 0);

      if (filtered.length) {
        setDrivers(filtered as any);
        setDriversDebug(`loaded from ${url} (${filtered.length})`);
        return;
      }
    } catch {
      // ignore and try next endpoint
    }
  }

  setDrivers([]);
  setDriversDebug("No drivers loaded from known endpoints");
}
'@

$newText = $before + $replacement + $after

[System.IO.File]::WriteAllText($target, $newText, $encUtf8NoBom)
Ok ("[OK] Patched: {0}" -f $target)

Write-Host ""
Write-Host "Next: run build" -ForegroundColor Cyan
Write-Host ("  cd `"{0}`"" -f $ProjRoot)
Write-Host "  npm.cmd run build"
Write-Host ""
Ok "[DONE] loadDrivers replaced (rows support + dropdown-safe id/name)."