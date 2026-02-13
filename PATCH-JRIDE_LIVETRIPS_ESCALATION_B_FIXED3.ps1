# PATCH-JRIDE_LIVETRIPS_ESCALATION_B_FIXED3.ps1
# One file only: app\admin\livetrips\LiveTripsClient.tsx
# UI-only. PowerShell 5. ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\admin\livetrips\LiveTripsClient.tsx"
$path = Join-Path $root $rel
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# --- FIX: replace invalid -like check with regex -match ---
$hasFlaggedState = $false
if ($txt -match 'const\s*\[\s*flaggedAt\s*,') {
  $hasFlaggedState = $true
}

# Anchor for nudgedAt
$anchorNudged = 'const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});'
if ($txt.IndexOf($anchorNudged) -lt 0) { Fail "Anchor not found: nudgedAt state" }

if ($hasFlaggedState) {
  Info "flaggedAt state already present (skip insert)."
} else {
  $ins = @'

  // ===== PHASE B: UI-only escalation (flagging) =====
  // Flagged trips are UI-only (no backend). Used for dispatcher follow-up.
  const [flaggedAt, setFlaggedAt] = useState<Record<string, number>>({});
  const [escalationStep, setEscalationStep] = useState<Record<string, number>>({}); // 0 none, 1 nudged, 2 auto-assigned, 3 flagged

  function isFlaggedTripKey(key: string): boolean {
    return !!(flaggedAt as any)[key];
  }

  function setFlagTripKey(key: string, step: number) {
    if (!key) return;
    setFlaggedAt((prev) => ({ ...(prev || {}), [key]: Date.now() }));
    setEscalationStep((prev) => ({ ...(prev || {}), [key]: step }));
  }

  function setEscStep(key: string, step: number) {
    if (!key) return;
    setEscalationStep((prev) => ({ ...(prev || {}), [key]: step }));
  }

'@
  $txt = $txt.Replace($anchorNudged, $anchorNudged + $ins)
  Ok "Inserted flaggedAt + escalationStep state/helpers."
}

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
