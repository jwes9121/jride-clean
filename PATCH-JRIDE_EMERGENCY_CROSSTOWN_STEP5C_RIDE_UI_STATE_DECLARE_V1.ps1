# PATCH-JRIDE_EMERGENCY_CROSSTOWN_STEP5C_RIDE_UI_STATE_DECLARE_V1.ps1
# STEP 5C UI FIX:
# - Ensure state vars are DECLARED (not just referenced)
# - Insert after isEmergency state if found, else after component opening brace
# - Safe to re-run

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$path = Join-Path $root "app\ride\page.tsx"
Backup-File $path

$txt = Get-Content -LiteralPath $path -Raw

# Real-declaration checks
$decl1 = "const [pickupDistanceKm, setPickupDistanceKm]"
$decl2 = "const [emergencyPickupFeePhp, setEmergencyPickupFeePhp]"

if (($txt.IndexOf($decl1) -ge 0) -and ($txt.IndexOf($decl2) -ge 0)) {
  Write-Host "[SKIP] STEP5C state declarations already exist"
} else {
  $inject = @'

  // ===== JRIDE STEP5C: Emergency pickup fee state =====
  const [pickupDistanceKm, setPickupDistanceKm] = React.useState<number | null>(null);
  const [emergencyPickupFeePhp, setEmergencyPickupFeePhp] = React.useState<number | null>(null);
  // ===== END JRIDE STEP5C =====

'@

  # Prefer inserting after isEmergency state line (best local scope)
  $isEmergencyNeedle = "const [isEmergency, setIsEmergency]"
  $p = $txt.IndexOf($isEmergencyNeedle)

  if ($p -ge 0) {
    $semi = $txt.IndexOf(";", $p)
    if ($semi -lt 0) { throw "Found isEmergency state but could not find ';' end of line." }

    $txt = $txt.Substring(0, $semi + 1) + $inject + $txt.Substring($semi + 1)
    Write-Host "[OK] Injected STEP5C state declarations after isEmergency state"
  } else {
    # Fallback: insert right after opening brace of export default function component
    $fn = $txt.IndexOf("export default function")
    if ($fn -lt 0) { throw "Cannot find 'export default function' in app/ride/page.tsx" }

    $brace = $txt.IndexOf("{", $fn)
    if ($brace -lt 0) { throw "Cannot find opening '{' for default function component" }

    $txt = $txt.Substring(0, $brace + 1) + $inject + $txt.Substring($brace + 1)
    Write-Host "[OK] Injected STEP5C state declarations at component top"
  }
}

# Write back UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8)

Write-Host "[DONE] Patched: $path"
Write-Host "NEXT: npm run build"
