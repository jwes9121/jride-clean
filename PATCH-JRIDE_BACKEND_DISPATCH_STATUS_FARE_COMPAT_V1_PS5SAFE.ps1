param(
  [Parameter(Mandatory=$true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File {
  param([string]$Path,[string]$Tag)
  $bakDir = Join-Path (Split-Path -Parent $Path) "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path -Leaf $Path) + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-OnceLiteral {
  param(
    [string]$Text,
    [string]$Needle,
    [string]$Replacement,
    [string]$Label
  )
  if (-not $Text.Contains($Needle)) {
    throw "Missing anchor for $Label"
  }
  return $Text.Replace($Needle, $Replacement)
}

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$routePath = Join-Path $RepoRoot "app\api\dispatch\status\route.ts"

if (-not (Test-Path $routePath)) { throw "File not found: $routePath" }

Backup-File -Path $routePath -Tag "BACKEND_DISPATCH_STATUS_FARE_COMPAT_V1"

$route = Get-Content -LiteralPath $routePath -Raw

$oldParse = @"
    const status =
      body.status ||
      null;

    if (!bookingId && !bookingCode) {
"@

$newParse = @"
    const status =
      body.status ||
      null;

    const proposedFareRaw = Number(body.proposed_fare);
    const baseFareRaw = Number(body.base_fare);
    const convenienceFeeRaw = Number(body.convenience_fee);

    let derivedProposedFare: number | null = null;
    if (Number.isFinite(proposedFareRaw) && proposedFareRaw >= 0) {
      derivedProposedFare = proposedFareRaw;
    } else if (Number.isFinite(baseFareRaw) && baseFareRaw >= 0) {
      const conv = Number.isFinite(convenienceFeeRaw) ? convenienceFeeRaw : 0;
      derivedProposedFare = baseFareRaw + conv;
    }

    if (!bookingId && !bookingCode) {
"@

$route = Replace-OnceLiteral -Text $route -Needle $oldParse -Replacement $newParse -Label "parse fare compatibility block"

$oldUpdate = @"
    let query = supabaseAdmin
      .from("bookings")
      .update({
        status: status,
        driver_id: driverId,
        assigned_driver_id: driverId,
        updated_at: new Date().toISOString(),
      });
"@

$newUpdate = @"
    const patch: any = {
      status: status,
      driver_id: driverId,
      assigned_driver_id: driverId,
      updated_at: new Date().toISOString(),
    };

    if (status === "fare_proposed" && derivedProposedFare !== null) {
      patch.proposed_fare = derivedProposedFare;
      patch.passenger_fare_response = null;
    }

    let query = supabaseAdmin
      .from("bookings")
      .update(patch);
"@

$route = Replace-OnceLiteral -Text $route -Needle $oldUpdate -Replacement $newUpdate -Label "update fare compatibility block"

if (-not $route.Contains("derivedProposedFare")) {
  throw "Verification failed: derivedProposedFare block missing"
}
if (-not $route.Contains("patch.proposed_fare = derivedProposedFare")) {
  throw "Verification failed: proposed_fare compatibility write missing"
}

Write-Utf8NoBom -Path $routePath -Content $route
Write-Host "[OK] Patched $routePath"
Write-Host ""
Write-Host "DONE: dispatch/status now supports legacy fare_proposed payloads."