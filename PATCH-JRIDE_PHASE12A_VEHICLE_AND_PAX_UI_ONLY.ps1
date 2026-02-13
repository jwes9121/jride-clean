# PATCH-JRIDE_PHASE12A_VEHICLE_AND_PAX_UI_ONLY.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# Does NOT change backend payloads (safe)

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

# ---- Anchors ----
if ($txt.IndexOf('const [town, setTown] = React.useState("Lagawe");') -lt 0) { Fail "Anchor not found: town state" }
if ($txt.IndexOf('const [passengerName, setPassengerName] = React.useState("Test Passenger A");') -lt 0) { Fail "Anchor not found: passengerName state" }
if ($txt.IndexOf("async function submit() {") -lt 0) { Fail "Anchor not found: submit()" }
if ($txt.IndexOf('<div className="font-semibold mb-3">Passenger</div>') -lt 0) { Fail "Anchor not found: Passenger card header" }
if ($txt.IndexOf('<label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>') -lt 0) { Fail "Anchor not found: Town label" }

# ---- 1) Insert vehicle + pax states after passengerName ----
$anchorState = 'const [passengerName, setPassengerName] = React.useState("Test Passenger A");'
if ($txt.IndexOf("vehicleType") -lt 0) {
  $insState = @"
const [passengerName, setPassengerName] = React.useState("Test Passenger A");

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
  $txt = $txt.Replace($anchorState, $insState)
  Write-Host "[OK] Inserted vehicleType + passengerCount state/helpers."
} else {
  Write-Host "[OK] vehicleType already present; skipping state insert."
}

# ---- 2) Add UI controls inside Passenger card (after Town select) ----
# Anchor on the Town select closing tag block. We'll insert right after the </select>.
$townSelectClose = '</select>'
$townLabelPos = $txt.IndexOf('<label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>')
if ($townLabelPos -lt 0) { Fail "Town label position not found" }

# Find the first </select> after Town label
$closePos = $txt.IndexOf($townSelectClose, $townLabelPos)
if ($closePos -lt 0) { Fail "Could not find </select> after Town select" }

# Insert only once (guard)
if ($txt.IndexOf("Vehicle type") -lt 0) {
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
                const v = vehicleType;
                setPassengerCount(clampPax(v, e.target.value));
              }}
            />
            <div className="mt-2 text-xs opacity-70">
              Fare is proposed by drivers. You can accept to proceed or reject to request another driver quote.
            </div>
"@
  # Replace ONLY the first occurrence at that closePos
  $txt = $txt.Substring(0, $closePos) + $insertUI + $txt.Substring($closePos + $townSelectClose.Length)
  Write-Host "[OK] Inserted Vehicle type + Passengers UI + fare note."
} else {
  Write-Host "[OK] Passenger UI already has vehicle type; skipping UI insert."
}

# ---- 3) Enforce selection rules before booking submit (UI-only validation) ----
# Insert near top of submit(): after setBusy(true)
$submitAnchor = "setBusy(true);"
$submitPos = $txt.IndexOf($submitAnchor)
if ($submitPos -lt 0) { Fail "Could not find submit busy anchor" }

# Guard to avoid double insert
if ($txt.IndexOf("PHASE12A_VALIDATE_VEHICLE_PAX") -lt 0) {
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
  $txt = $txt.Replace($submitAnchor, $submitAnchor + $validation)
  Write-Host "[OK] Added submit() UI validation for vehicle/pax."
} else {
  Write-Host "[OK] Submit validation already present; skipping."
}

# NOTE: We intentionally do NOT add vehicleType/passengerCount to /book payload yet to avoid breaking backend.

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
