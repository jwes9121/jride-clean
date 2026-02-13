# PATCH-JRIDE_PHASE12A_R_VEHICLE_PAX_UI_ONLY_STRONG_ANCHOR.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# UI-only: adds Vehicle type + Passengers + fare note under Passenger card
# Does NOT change booking payload (safe)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel  = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# ----- 1) Ensure state + helpers exist (insert after passengerName state) -----
if ($txt.IndexOf("const [vehicleType, setVehicleType]") -lt 0) {
  $rePassengerState = 'const\s+\[passengerName,\s*setPassengerName\]\s*=\s*React\.useState\([^\)]*\);\s*'
  if (-not [regex]::IsMatch($txt, $rePassengerState)) {
    Fail "Could not find passengerName state to insert vehicle/pax state. Paste the top state block (first ~80 lines) of app/ride/page.tsx."
  }

  $insState = @"
`$0

  // Phase 12A (UI-only): Vehicle type + passenger count
  const [vehicleType, setVehicleType] = React.useState<"tricycle" | "motorcycle">("tricycle");
  const [passengerCount, setPassengerCount] = React.useState<string>("1");

  function paxMaxForVehicle(v: string): number {
    return v === "motorcycle" ? 1 : 4;
  }

  function clampPax(v: string, raw: string): string {
    const t = String(raw || "").trim();
    if (!t) return "1";
    const n = Math.floor(Number(t));
    if (!Number.isFinite(n) || n <= 0) return "1";
    const max = paxMaxForVehicle(v);
    return String(Math.min(n, max));
  }

"@

  $txt = [regex]::Replace($txt, $rePassengerState, $insState, 1)
  Write-Host "[OK] Inserted vehicleType + passengerCount state/helpers."
} else {
  Write-Host "[OK] vehicleType state already present; skipping."
}

# ----- 2) Insert UI inside Passenger card (strong anchor: Passenger header block) -----
# We locate the Passenger card chunk and inject UI right after the Town </select>.
if ($txt.IndexOf("Vehicle type") -ge 0 -or $txt.IndexOf("Passengers") -ge 0) {
  Write-Host "[OK] Vehicle/Passengers UI seems already present; skipping UI insert."
} else {
  $passHdr = '<div className="font-semibold mb-3">Passenger</div>'
  $p0 = $txt.IndexOf($passHdr)
  if ($p0 -lt 0) { Fail "Anchor not found: Passenger card header" }

  # Find the Town select close within Passenger card region (search in next 2500 chars)
  $regionLen = 2500
  $pEnd = [Math]::Min($txt.Length, $p0 + $regionLen)
  $region = $txt.Substring($p0, $pEnd - $p0)

  # Find first </select> after the Town label within that region
  $townLabelRe = '<label\s+className="block\s+text-xs\s+font-semibold\s+opacity-70\s+mb-1\s+mt-3">\s*Town\s*</label>'
  if (-not [regex]::IsMatch($region, $townLabelRe)) {
    Fail "Could not find Town label inside Passenger card region. The Passenger card markup changed. Paste the Passenger card JSX chunk."
  }

  $idxTownLabel = [regex]::Match($region, $townLabelRe).Index
  $idxSelectClose = $region.IndexOf("</select>", $idxTownLabel)
  if ($idxSelectClose -lt 0) { Fail "Could not find </select> for Town inside Passenger card." }

  $insertUI = @"
</select>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Vehicle type</label>
            <select
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={vehicleType}
              onChange={(e) => {
                const v = (e.target.value as any) === "motorcycle" ? "motorcycle" : "tricycle";
                setVehicleType(v);
                setPassengerCount((prev) => clampPax(v, prev));
              }}
            >
              <option value="tricycle">Tricycle (max 4 passengers)</option>
              <option value="motorcycle">Motorcycle (max 1 passenger)</option>
            </select>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Passengers</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              inputMode="numeric"
              value={passengerCount}
              onChange={(e) => {
                setPassengerCount(clampPax(vehicleType, e.target.value));
              }}
            />

            <div className="mt-2 text-xs opacity-70">
              Fare is proposed by drivers. You can accept to proceed or reject to request another driver quote.
            </div>
"@

  # Replace only the specific </select> occurrence we found inside the region
  $before = $txt.Substring(0, $p0)
  $afterRegion = $txt.Substring($p0)
  $regionBeforeClose = $afterRegion.Substring(0, $idxSelectClose)
  $regionAfterClose  = $afterRegion.Substring($idxSelectClose + 9) # len("</select>") = 9

  $txt = $before + $regionBeforeClose + $insertUI + $regionAfterClose
  Write-Host "[OK] Inserted Vehicle type + Passengers UI under Passenger card."
}

# ----- 3) UI-only validation in submit(): must have valid pax -----
if ($txt.IndexOf("PHASE12A_VALIDATE_VEHICLE_PAX") -lt 0) {
  $submitRe = 'async\s+function\s+submit\s*\(\s*\)\s*\{'
  if (-not [regex]::IsMatch($txt, $submitRe)) { Fail "Anchor not found: submit() header" }

  $busyAnchor = "setBusy(true);"
  $iBusy = $txt.IndexOf($busyAnchor)
  if ($iBusy -lt 0) { Fail "Anchor not found: setBusy(true);" }

  $validation = @"

    // PHASE12A_VALIDATE_VEHICLE_PAX (UI-only)
    const v = (vehicleType === "motorcycle") ? "motorcycle" : "tricycle";
    const pax = Number(clampPax(v, passengerCount));
    const maxPax = paxMaxForVehicle(v);

    if (!pax || !Number.isFinite(pax) || pax <= 0) {
      setResult("Please enter passengers (1 to " + String(maxPax) + ").");
      setBusy(false);
      return;
    }
    if (pax > maxPax) {
      setResult("Too many passengers for " + v + ". Max is " + String(maxPax) + ".");
      setBusy(false);
      return;
    }

"@
  $txt = $txt.Replace($busyAnchor, $busyAnchor + $validation)
  Write-Host "[OK] Added submit() UI-only validation for vehicle/pax."
} else {
  Write-Host "[OK] submit() validation already present; skipping."
}

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
