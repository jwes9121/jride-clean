# FIX-JRIDE_PHASE3E_VENDORORDERS_TOWN_FROM_VENDOR_V2.ps1
# PHASE 3E: ensure bookings.town is set for takeout orders
# - Prefer explicit body.town/municipality if provided
# - Else fetch vendor's town/municipality from vendors/vendor_profiles
# - Else fallback to deriveTownFromLatLng(vendor coords)
# No UI/auth/wallet/schema changes. Backup before patch. UTF-8 no BOM.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

function BackupFile($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Ok "Backup: $bak"
}

function ReadText($p){
  return [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}

function WriteUtf8NoBom($p, $txt){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}

$path = "app\api\vendor-orders\route.ts"
Info "Target: $path"
BackupFile $path

$txt = ReadText $path

# 1) Insert fetchVendorTown() helper near existing fetchVendorCoords helper
if($txt -notlike "*PHASE_3E_VENDOR_TOWN_HELPER*"){
  $anchor = "async function fetchVendorCoords"
  $idx = $txt.IndexOf($anchor)
  if($idx -lt 0){ Fail "Anchor not found: async function fetchVendorCoords" }

  $insert = @'
/* PHASE_3E_VENDOR_TOWN_HELPER */
async function fetchVendorTown(admin: any, vendorId: string): Promise<string | null> {
  const candidates: Array<[string, string]> = [
    ["vendors", "id"],
    ["vendor_profiles", "id"],
    ["vendors", "vendor_id"],
    ["vendor_profiles", "vendor_id"],
  ];

  function pickTown(row: any): string | null {
    if (!row || typeof row !== "object") return null;
    const keys = Object.keys(row);
    const lower: Record<string, any> = {};
    for (const k of keys) lower[k.toLowerCase()] = (row as any)[k];

    const cands = ["town", "municipality", "lgu", "zone", "city"];
    for (const k of cands) {
      if (k in lower) {
        const v = String(lower[k] ?? "").trim();
        if (v) return v;
      }
    }
    return null;
  }

  for (const [table, key] of candidates) {
    const row = await tryFetchRowById(admin, table, key, vendorId);
    const t = pickTown(row);
    if (t) return t;
  }
  return null;
}
/* PHASE_3E_VENDOR_TOWN_HELPER_END */

'@

  $txt = $txt.Substring(0,$idx) + $insert + $txt.Substring($idx)
  Ok "Inserted fetchVendorTown() helper."
}else{
  Ok "fetchVendorTown() helper already present."
}

# 2) Compute derivedTown in POST after vendorLL/dropLL are computed
if($txt -notlike "*PHASE_3E_DERIVED_TOWN_VAR*"){
  $anchor2 = "const dropLL = await fetchAddressCoords"
  $p2 = $txt.IndexOf($anchor2)
  if($p2 -lt 0){ Fail "Anchor not found: const dropLL = await fetchAddressCoords" }
  $lineEnd = $txt.IndexOf("`n", $p2)
  if($lineEnd -lt 0){ Fail "Could not find line end after dropLL line." }

  $insert2 = @'
  // PHASE_3E_DERIVED_TOWN_VAR
  const explicitTown = String((body as any)?.town ?? (body as any)?.municipality ?? "").trim() || null;
  const vendorTown = explicitTown ? null : await fetchVendorTown(admin, vendor_id);
  const derivedTown = (explicitTown || vendorTown || deriveTownFromLatLng(vendorLL.lat, vendorLL.lng)) || null;

'@

  $txt = $txt.Substring(0,$lineEnd+1) + $insert2 + $txt.Substring($lineEnd+1)
  Ok "Inserted derivedTown computation after dropLL."
}else{
  Ok "derivedTown var already present."
}

# 3) Ensure payload uses derivedTown and NOT zone
$marker = "PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS"
if($txt -notlike "*$marker*"){
  Fail "Could not find marker '$marker' in createPayload. Paste your createPayload town block if marker name differs."
}

# Replace the town line inside that block to use derivedTown
$reTown = New-Object System.Text.RegularExpressions.Regex("(?m)^\s*town\s*:\s*.*?,\s*$")
$before = $txt
$txt = $reTown.Replace($txt, "    town: (typeof derivedTown !== ""undefined"" ? derivedTown : null),", 1)

if($txt -eq $before){
  Fail "Could not replace town line (unexpected payload shape). Paste the PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS block."
}
Ok "Updated createPayload town to use derivedTown."

# Ensure there is no zone line lingering in payload (remove one line that starts with 'zone:')
$lines = $txt -split "`r?`n"
$out = New-Object System.Collections.Generic.List[string]
$removed = 0
foreach($ln in $lines){
  if($removed -eq 0 -and ($ln -match "^\s*zone\s*:")){
    $removed++
    continue
  }
  $out.Add($ln)
}
if($removed -gt 0){ Ok "Removed lingering zone payload line." } else { Ok "No zone payload line found (good)." }
$txt = ($out -join "`r`n")

WriteUtf8NoBom $path $txt
Ok "Wrote: $path (UTF-8 no BOM)"

Write-Host ""
Write-Host "[NEXT] Run build:" -ForegroundColor Cyan
Write-Host "npm run build" -ForegroundColor White
