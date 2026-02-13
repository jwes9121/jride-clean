# PATCH-JRIDE_PHASE7A_STABILIZE_TABS_STATUS_AND_MARKER_ASCII_SAFE.ps1
# ASCII-SAFE patch (no curly quotes / dashes / unicode literals)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function Backup-File($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}

function Read-Text($p){
  return Get-Content -LiteralPath $p -Raw -Encoding UTF8
}

function Write-Text($p, $txt){
  # Remove common mojibake artifacts without embedding any unicode literals
  # - Removes "" (U+00C2) often seen as stray prefix
  # - Replaces ellipsis U+2026 with "..."
  # - Replaces em dash U+2014 with "--"
  # - Replaces en dash U+2013 with "-"
  $txt = $txt.Replace([char]0x00C2, "")
  $txt = $txt.Replace([char]0x2026, "...")
  $txt = $txt.Replace([char]0x2014, "--")
  $txt = $txt.Replace([char]0x2013, "-")

  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}

$P1 = "app\admin\livetrips\LiveTripsClient.tsx"
$P2 = "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup-File $P1
Backup-File $P2

# ----------------------------
# LiveTripsClient.tsx patches
# ----------------------------
$t = Read-Text $P1

# 0) Hard stop if file is already syntactically broken in the top region we touch
# (we still continue, but this helps you see if the anchor text is missing)
if($t.Length -lt 200){ Fail "LiveTripsClient.tsx looks too small/unexpected." }

# 1) Normalize normStatus: spaces/hyphens -> underscores
# We do a simple targeted replace:
# Find "function normStatus" block and replace body with our version.
$normStatusMatch = [regex]::Match($t, "(?s)function\s+normStatus\s*\(\s*s\s*:\s*any\s*\)\s*\{.*?\}")
if(-not $normStatusMatch.Success){ Fail "Could not find function normStatus(s: any) { ... } in $P1" }

$normStatusNew = @'
function normStatus(s: any) {
  return String(s || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}
'@

$t = $t.Substring(0, $normStatusMatch.Index) + $normStatusNew + $t.Substring($normStatusMatch.Index + $normStatusMatch.Length)

# 2) Ensure helper isRealTripRow exists (filters out synthetic/empty rows so counts/list match)
if($t -notmatch "function\s+isRealTripRow\s*\("){
  $anchor = [regex]::Match($t, "(?s)function\s+normTripId\s*\(.*?\}\s*")
  if(-not $anchor.Success){ Fail "Could not find normTripId() to anchor insertion in $P1" }

  $insert = @'

function isRealTripRow(t: any): boolean {
  const code = String(t?.booking_code ?? t?.bookingCode ?? "").trim();
  if (!code) return false;
  const lower = code.toLowerCase();
  if (lower === "null" || lower === "undefined") return false;
  return true;
}

'@

  $t = $t.Insert($anchor.Index + $anchor.Length, $insert)
}

# 3) Add pending override types near JRIDE_LIVETRIPS_EVT (no unicode)
if($t -notmatch "PendingOverride"){
  $idx = $t.IndexOf("const JRIDE_LIVETRIPS_EVT")
  if($idx -lt 0){ Fail "Could not find const JRIDE_LIVETRIPS_EVT in $P1" }

  $ins = @'
// JRIDE_PENDING_STATUS_OVERRIDE
type PendingOverride = { status: string; until: number };

'@
  $t = $t.Insert($idx, $ins)
}

# 4) Add pendingOverridesRef inside component right after function start
if($t -notmatch "pendingOverridesRef"){
  $comp = [regex]::Match($t, "(?s)export\s+default\s+function\s+LiveTripsClient\s*\(\)\s*\{")
  if(-not $comp.Success){ Fail "Could not find LiveTripsClient() start in $P1" }
  $pos = $comp.Index + $comp.Length
  $t = $t.Insert($pos, "`n  const pendingOverridesRef = React.useRef<Record<string, PendingOverride>>({});`n")
}

# 5) Ensure realTrips is defined before visibleTrips
if($t -notmatch "const\s+realTrips\s*=\s*allTrips\.filter\(isRealTripRow\)"){
  $mVis = [regex]::Match($t, "(?s)\n\s*const\s+visibleTrips\s*=\s*(React\.)?useMemo\s*\(")
  if(-not $mVis.Success){ Fail "Could not find visibleTrips useMemo in $P1" }
  $t = $t.Insert($mVis.Index, "`n  const realTrips = allTrips.filter(isRealTripRow);`n")
}

# 6) Replace visibleTrips computation to use realTrips consistently
# We replace the whole visibleTrips useMemo block if we can match it.
$vis = [regex]::Match($t, "(?s)const\s+visibleTrips\s*=\s*(React\.)?useMemo\s*\(\s*\(\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\)\s*;")
if(-not $vis.Success){ Fail "Could not match visibleTrips useMemo block in $P1 (structure differs). Paste the visibleTrips block." }

$visNew = @'
const visibleTrips = useMemo(() => {
  const f = tripFilter;
  let out: TripRow[] = [];
  if (f === "dispatch") out = realTrips.filter((t) => ["pending", "assigned", "on
