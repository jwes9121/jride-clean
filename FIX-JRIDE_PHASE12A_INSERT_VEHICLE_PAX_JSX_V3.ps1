# FIX-JRIDE_PHASE12A_INSERT_VEHICLE_PAX_JSX_V3.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# Inserts Vehicle type + Passengers JSX under Passenger card (after Town select)
# Does NOT change booking payload

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

# Hard guard: do not duplicate if JSX already exists
$jsxNeedle = '<label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Vehicle type</label>'
if ($txt.IndexOf($jsxNeedle) -ge 0) {
  Fail "Vehicle/Pax JSX already exists in the file. Aborting to avoid duplicates."
}

# Anchor: Passenger card header
$passHdr = '<div className="font-semibold mb-3">Passenger</div>'
$p0 = $txt.IndexOf($passHdr)
if ($p0 -lt 0) { Fail "Anchor not found: Passenger header div" }

# Search within Passenger card region for Town label and first </select>
$searchLen = 7000
$pEnd = [Math]::Min($txt.Length, $p0 + $searchLen)
$region = $txt.Substring($p0, $pEnd - $p0)

$townNeedle = ">Town</label>"
$tl = $region.IndexOf($townNeedle)
if ($tl -lt 0) { Fail "Could not find Town label inside Passenger card region." }

$selClose = $region.IndexOf("</select>", $tl)
if ($selClose -lt 0) { Fail "Could not find </select> for Town inside Passenger card region." }

$absInsertPos = $p0 + $selClose + 9  # len("</select>") = 9

$ui = @"

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

$txt = $txt.Substring(0, $absInsertPos) + $ui + $txt.Substring($absInsertPos)

# Post-check
if ($txt.IndexOf($jsxNeedle) -lt 0) { Fail "Post-check failed: Vehicle type JSX label not found after insertion." }

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Inserted Vehicle/Pax JSX under Passenger card: $FileRel"
