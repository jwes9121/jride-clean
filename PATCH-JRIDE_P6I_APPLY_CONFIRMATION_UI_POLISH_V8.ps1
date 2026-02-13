# PATCH-JRIDE_P6I_APPLY_CONFIRMATION_UI_POLISH_V8.ps1
# P6I: UI-only polish — show "Applied" badge + brief highlight after Apply Draft
# Success hook: insert setJustApplied(true); right before await loadPage(); in the apply-fare handler
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$uiFile = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $uiFile)){ Fail ('UI file not found: ' + $uiFile) }

$ui = Get-Content -LiteralPath $uiFile -Raw -Encoding UTF8

if($ui.IndexOf('const [lastAction, setLastAction]') -lt 0){ Fail 'Anchor not found: lastAction state' }
if($ui.IndexOf('Apply Draft') -lt 0){ Fail 'Anchor not found: Apply Draft' }
if($ui.IndexOf('fetch("/api/admin/livetrips/apply-fare"') -lt 0){ Fail 'Anchor not found: apply-fare fetch' }

# Prevent double patch
if($ui.IndexOf('P6I_APPLY_OK') -ge 0){ Fail 'P6I already applied. Aborting.' }

# Backup
$bak = "$uiFile.bak.$(Stamp)"
Copy-Item -LiteralPath $uiFile -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# 1) Add justApplied state after lastAction state
$stateAnchor = 'const [lastAction, setLastAction] = useState<string>("");'
if($ui.IndexOf($stateAnchor) -lt 0){ Fail 'Exact anchor not found: lastAction state line' }

$stateInsert = @'
const [lastAction, setLastAction] = useState<string>("");

  // P6I_APPLY_OK: transient UI confirmation after Apply Draft
  const [justApplied, setJustApplied] = useState(false);
'@.TrimEnd()

$ui2 = $ui.Replace($stateAnchor, $stateInsert)
if($ui2 -eq $ui){ Fail 'State insert failed (no change).' }

# 2) Insert auto-clear effect before first useEffect(() => {
$effectAnchor = 'useEffect(() => {'
$posEff = $ui2.IndexOf($effectAnchor)
if($posEff -lt 0){ Fail 'Anchor not found: useEffect(() => {' }

$effectInsert = @'
useEffect(() => {
    if (!justApplied) return;
    const t = setTimeout(() => setJustApplied(false), 2500);
    return () => clearTimeout(t);
  }, [justApplied]);

'@.TrimEnd() + "`r`n`r`n"

$ui3 = $ui2.Substring(0, $posEff) + $effectInsert + $ui2.Substring($posEff)

# 3) Success hook: locate apply-fare handler region then insert before await loadPage();
$posFetch = $ui3.IndexOf('fetch("/api/admin/livetrips/apply-fare"')
if($posFetch -lt 0){ Fail 'Internal: fetch anchor missing after edits' }

$posLoad = $ui3.IndexOf('await loadPage();', $posFetch)
if($posLoad -lt 0){ Fail 'Anchor not found: await loadPage(); after apply-fare fetch' }

# Insert setJustApplied(true); right before await loadPage();
$hook = 'setJustApplied(true);' + "`r`n" + '            '
$ui4 = $ui3.Substring(0, $posLoad) + $hook + $ui3.Substring($posLoad)

# 4) Highlight Fare card + badge: replace FIRST Fare card container
$fareAnchor = '<div className="rounded border bg-white p-3">'
$posFare = $ui4.IndexOf($fareAnchor)
if($posFare -lt 0){ Fail 'Fare card anchor not found.' }

$fareReplace = @'
<div className={`rounded border bg-white p-3 transition-shadow ${justApplied ? "ring-2 ring-green-500/60 shadow-md" : ""}`}>
  {justApplied && (
    <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-green-700">
      <span>OK</span>
      <span>Applied</span>
    </div>
  )}
'@.TrimEnd()

$ui5 = $ui4.Substring(0, $posFare) + $fareReplace + $ui4.Substring($posFare + $fareAnchor.Length)

Set-Content -LiteralPath $uiFile -Value $ui5 -Encoding UTF8
Write-Host "[OK] Patched: $uiFile"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Admin LiveTrips -> Apply Draft -> highlight + Applied badge appears briefly"
