# PATCH-JRIDE_PHASE7A_HIDE_DRIVER_WALLET_WHEN_NO_DRIVER-FIXED.ps1
# PHASE 7A — UI-only guard: don't open Driver wallet ledger when trip has no driver_id
# Touches ONLY: app\admin\livetrips\LiveTripsClient.tsx

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Backup($p){
  if(!(Test-Path -LiteralPath $p)){ throw "Missing: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}
function ReadRaw($p){ Get-Content -LiteralPath $p -Raw }
function WriteUtf8NoBom($p,$c){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $c, $enc)
  Write-Host "[OK] Wrote $p"
}

$P = "app\admin\livetrips\LiveTripsClient.tsx"
Backup $P

$txt = ReadRaw $P

if ($txt -notmatch "View ledger") { throw "Could not find 'View ledger' in $P. Paste the Driver wallet panel block." }
if ($txt -match "JRIDE_PHASE7A_DRIVER_LEDGER_GUARD") {
  Write-Host "[OK] Guard already present; nothing to do."
  exit 0
}

# Guard block to inject into TSX onClick
$guardOpen = @'
{
  // JRIDE_PHASE7A_DRIVER_LEDGER_GUARD
  const d = (selectedTrip as any)?.driver_id;
  if (!d) {
    alert("No driver assigned on this trip.");
    return;
  }
'@

$guardClose = @'
}
'@

$txt2 = $txt

# Pattern A: onClick={() => setSomething(true)}
$txt2 = [regex]::Replace(
  $txt2,
  '(onClick=\{\(\)\s*=>\s*)(set[A-Za-z0-9_]*Wallet[A-Za-z0-9_]*\(\s*true\s*\)\s*)(\}\})',
  {
    param($m)
    $prefix = $m.Groups[1].Value
    $call   = $m.Groups[2].Value
    $suffix = $m.Groups[3].Value
    return $prefix + $guardOpen + '  ' + $call + "`n" + $guardClose + $suffix
  },
  1
)

# Pattern B: onClick={() => openSomething()}
if ($txt2 -eq $txt) {
  $txt2 = [regex]::Replace(
    $txt2,
    '(onClick=\{\(\)\s*=>\s*)(open[A-Za-z0-9_]*Wallet[A-Za-z0-9_]*\(\)\s*)(\}\})',
    {
      param($m)
      $prefix = $m.Groups[1].Value
      $call   = $m.Groups[2].Value
      $suffix = $m.Groups[3].Value
      return $prefix + $guardOpen + '  ' + $call + "`n" + $guardClose + $suffix
    },
    1
  )
}

if ($txt2 -eq $txt) {
  throw "Could not patch wallet ledger click handler automatically. Paste the 'Driver wallet' card block (around View ledger)."
}

WriteUtf8NoBom $P $txt2
Write-Host "[DONE] Driver wallet ledger is now guarded when no driver_id."
