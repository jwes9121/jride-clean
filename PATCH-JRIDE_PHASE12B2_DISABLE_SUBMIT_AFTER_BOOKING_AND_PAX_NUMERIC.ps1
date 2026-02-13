# PATCH-JRIDE_PHASE12B2_DISABLE_SUBMIT_AFTER_BOOKING_AND_PAX_NUMERIC.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# UI-only: disables Submit after booking_code exists (activeCode), until Clear resets it.
# Also improves passengers input to type=number with min/max.

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
if ($txt.IndexOf('const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked;') -lt 0) { Fail "Anchor not found: allowSubmit baseline line" }
if ($txt.IndexOf('disabled={!allowSubmit}') -lt 0) { Fail "Anchor not found: submit button disabled={!allowSubmit}" }
if ($txt.IndexOf('onClick={() => setResult("")}') -lt 0) { Fail "Anchor not found: Clear button handler setResult(\"\")" }
if ($txt.IndexOf('value={vehicleType}') -lt 0) { Fail "Anchor not found: vehicleType select value" }
if ($txt.IndexOf('value={passengerCount}') -lt 0) { Fail "Anchor not found: passengerCount input value" }

# ---- 1) allowSubmit also blocked when a booking has been submitted (activeCode set) ----
$txt = $txt.Replace(
  'const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked;',
  @'
  const bookingSubmitted = !!activeCode;
  const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked && !bookingSubmitted;
'@
)
Write-Host "[OK] Updated allowSubmit to disable after bookingSubmitted."

# ---- 2) Update submit button title + label when bookingSubmitted ----
# Title line:
$txt = $txt.Replace(
  'title={!allowSubmit ? "Booking is blocked by rules above" : "Submit booking"}',
  'title={bookingSubmitted ? "Booking already submitted. Press Clear to book again." : (!allowSubmit ? "Booking is blocked by rules above" : "Submit booking")}'
)

# Button label line (keep Booking... while busy)
$txt = $txt.Replace(
  '{busy ? "Booking..." : "Submit booking"}',
  '{busy ? "Booking..." : (bookingSubmitted ? "Booking submitted" : "Submit booking")}'
)
Write-Host "[OK] Updated submit button title/label."

# ---- 3) Disable vehicle + passenger inputs once booking is submitted (prevents confusion) ----
# Vehicle select: inject disabled and class opacity tweak
# Replace the opening <select ... value={vehicleType} ...> with a version that includes disabled.
$vehRe = '(?s)(<select\s*\n\s*className="w-full rounded-xl border border-black/10 px-3 py-2"\s*\n\s*value=\{vehicleType\}\s*\n\s*onChange=\{\(e\)\s*=>\s*\{\s*)'
if (-not [regex]::IsMatch($txt, $vehRe)) { Fail "Could not locate vehicle <select> block for patch." }
$txt = [regex]::Replace($txt, $vehRe, '$1', 1)
# Insert disabled attribute right after value line (simple anchor replace)
$txt = $txt.Replace(
  'value={vehicleType}',
  'value={vehicleType}' + "`n" + '              disabled={busy || bookingSubmitted}'
)
# Make disabled visually obvious (append opacity when disabled)
$txt = $txt.Replace(
  'className="w-full rounded-xl border border-black/10 px-3 py-2"',
  'className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}'
)
Write-Host "[OK] Disabled vehicle select when bookingSubmitted/busy."

# Passenger input: make it a number field with min/max and disable when submitted
$passInputNeedle = 'value={passengerCount}'
$passPos = $txt.IndexOf($passInputNeedle)
if ($passPos -lt 0) { Fail "Passenger input not found by value={passengerCount}" }

# Add type/min/max/disabled near the passenger input definition.
# Guard: don't duplicate if already has type="number"
if ($txt.IndexOf('value={passengerCount}') -ge 0 -and $txt.IndexOf('type="number"') -lt 0) {
  $txt = $txt.Replace(
    'inputMode="numeric"',
    'type="number"' + "`n" +
    '              inputMode="numeric"' + "`n" +
    '              min={1}' + "`n" +
    '              max={paxMaxForVehicle(vehicleType)}' + "`n" +
    '              step={1}' + "`n" +
    '              disabled={busy || bookingSubmitted}'
  )
  Write-Host "[OK] Upgraded passengers input to number/min/max and disabled when bookingSubmitted/busy."
} else {
  Write-Host "[OK] Passengers input already upgraded; skipping."
}

# Also dim passengers input when disabled (append opacity class)
$txt = $txt.Replace(
  'className="w-full rounded-xl border border-black/10 px-3 py-2"',
  'className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}'
)

# ---- 4) Make Clear reset the submitted booking state (activeCode + live panel) ----
$clearOld = 'onClick={() => setResult("")}'
$clearNew = @'
onClick={() => {
              setResult("");
              setActiveCode("");
              setLiveStatus("");
              setLiveDriverId("");
              setLiveUpdatedAt(null);
              setLiveErr("");
            }}
'@
$txt = $txt.Replace($clearOld, $clearNew)
Write-Host "[OK] Clear now resets activeCode + live status (unlocking Submit)."

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
