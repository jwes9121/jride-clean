param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE LiveTrips: loadDrivers rows-fix (V3 / PS5-safe) =="

if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail ("[FAIL] ProjRoot not found: {0}" -f $ProjRoot) }

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) { Fail ("[FAIL] Missing file: {0}" -f $target) }

# --- backup ---
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (-not (Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("LiveTripsClient.tsx.bak.LOADDRIVERS_ROWS_FIX_V3.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# --- read bytes and remove BOM if present ---
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($target)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $bytes = $bytes[3..($bytes.Length-1)]
  Ok "[OK] Removed UTF-8 BOM from LiveTripsClient.tsx"
}
$enc = New-Object System.Text.UTF8Encoding($false)
$text = $enc.GetString($bytes)

# --- find "async function loadDrivers" start ---
$needle = "async function loadDrivers"
$start = $text.IndexOf($needle)
if ($start -lt 0) { Fail "[FAIL] Could not find 'async function loadDrivers' in LiveTripsClient.tsx." }

# find opening brace '{' for the function
$openBrace = $text.IndexOf("{", $start)
if ($openBrace -lt 0) { Fail "[FAIL] Could not find '{' after loadDrivers declaration." }

# --- match closing brace for the function body (brace depth parser, PS5-safe) ---
function Find-MatchingBraceIndex([string]$s, [int]$openIdx) {
  $len = $s.Length
  $depth = 0
  $inS = $false
  $inD = $false
  $inT = $false
  $i = $openIdx
  while ($i -lt $len) {
    $ch = $s[$i]

    if ($inS) { if ($ch -eq "'") { $inS = $false }; $i++; continue }
    if ($inD) { if ($ch -eq '"') { $inD = $false }; $i++; continue }
    if ($inT) { if ($ch -eq '`') { $inT = $false }; $i++; continue }

    if ($ch -eq "'") { $inS = $true; $i++; continue }
    if ($ch -eq '"') { $inD = $true; $i++; continue }
    if ($ch -eq '`') { $inT = $true; $i++; continue }

    if ($ch -eq "{") { $depth++ }
    elseif ($ch -eq "}") {
      $depth--
      if ($depth -eq 0) { return $i }
    }
    $i++
  }
  return -1
}

$closeBrace = Find-MatchingBraceIndex $text $openBrace
if ($closeBrace -lt 0) { Fail "[FAIL] Could not match closing '}' for loadDrivers() body." }

# include trailing newline(s) after the function for clean replacement
$after = $closeBrace + 1
while ($after -lt $text.Length -and ($text[$after] -eq "`r" -or $text[$after] -eq "`n" -or $text[$after] -eq " " -or $text[$after] -eq "`t")) {
  # stop once we hit a blank line after function
  if ($text[$after] -eq "`n") { break }
  $after++
}

# --- replacement function (ASCII-only) ---
$replacement = @'
async function loadDrivers() {
  // Robust driver loader:
  // - Supports { ok:true, rows:[...] } and other common shapes
  // - Picks FIRST non-empty array (do NOT use "[] || []" because [] is truthy)
  // - Normalizes driver_id/status/town/lat/lng so dropdown always has IDs

  const endpoints = [
    "/api/admin/driver_locations",
    "/api/admin/driver-locations",
    "/api/admin/drivers",
    "/api/driver_locations",
    "/api/driver-locations",
  ];

  const pickFirstNonEmptyArray = (j: any) => {
    const candidates = [
      j?.rows,
      j?.drivers,
      j?.data,
      j?.items,
      j?.locations,
      j?.["0"],
      Array.isArray(j) ? j : null,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) return c;
    }
    return [];
  };

  const normalize = (arr: any[]) => {
    return (arr || []).map((d: any) => {
      const driver_id = String(d?.driver_id ?? d?.driverId ?? d?.id ?? "").trim() || null;
      const name = d?.name ?? d?.driver_name ?? d?.full_name ?? null;
      const phone = d?.phone ?? d?.driver_phone ?? null;
      const town = d?.town ?? d?.zone ?? d?.home_town ?? null;
      const status = String(d?.status ?? "").trim().toLowerCase() || null;

      const latNum = Number(d?.lat);
      const lngNum = Number(d?.lng);

      return {
        driver_id,
        name,
        phone,
        town,
        status,
        lat: Number.isFinite(latNum) ? latNum : null,
        lng: Number.isFinite(lngNum) ? lngNum : null,
        updated_at: d?.updated_at ?? null,
      };
    }).filter((d: any) => !!d.driver_id);
  };

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;

      const j: any = await r.json().catch(() => ({}));
      const raw = pickFirstNonEmptyArray(j);
      const arr = normalize(raw);

      if (arr.length) {
        setDrivers(arr);
        setDriversDebug(`loaded from ${url} (${arr.length})`);
        return;
      }
    } catch {
      // try next endpoint
    }
  }

  setDrivers([]);
  setDriversDebug("No drivers loaded from known endpoints (check endpoint path / auth / RLS).");
}
'@

# --- replace original function block ---
$beforeText = $text.Substring(0, $start)
$afterText  = $text.Substring($closeBrace + 1)
$newText = $beforeText + $replacement + $afterText

# write UTF-8 no BOM
[System.IO.File]::WriteAllText($target, $newText, $enc)
Ok ("[OK] Patched loadDrivers() in: {0}" -f $target)

Write-Host ""
Ok "[DONE] Next: rebuild and refresh LiveTrips."
Write-Host "  cd `"$ProjRoot`""
Write-Host "  npm.cmd run build"