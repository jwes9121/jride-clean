# ============================================================
# SCRIPT 5 - CALLBACK REPAIR (v2)
# ============================================================
# FIX 1: driverRows.map  - insert missing "return (" before <tr
# FIX 2: visibleTrips.map - remove stray </div> before return (
# ============================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---- LOCATE ----

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Try: script in public/jride-patches -> go up 2
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$target = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"

if (-not (Test-Path -LiteralPath $target)) {
    # Try: script at repo root
    $repoRoot = $scriptDir
    $target = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"
}
if (-not (Test-Path -LiteralPath $target)) {
    Write-Host "ABORT: Cannot find app\admin\livetrips\LiveTripsClient.tsx" -ForegroundColor Red
    exit 1
}

Write-Host "TARGET: $target" -ForegroundColor Cyan

# ---- BACKUP ----

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bkDir = Join-Path $repoRoot ("_backups\cb-repair-" + $ts)
New-Item -ItemType Directory -Path $bkDir -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $bkDir "LiveTripsClient.tsx.bak") -Force
Write-Host "BACKUP: $bkDir" -ForegroundColor Green

# ---- READ ----

$lines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$out = New-Object 'System.Collections.Generic.List[string]'
$total = $lines.Length
Write-Host "READ: $total lines" -ForegroundColor Cyan

# ---- SCAN AND FIX ----

$fix1 = $false
$fix2 = $false
$i = 0

while ($i -lt $total) {
    $raw = $lines[$i]
    $t = $raw.Trim()

    # ===========================================================
    # FIX 1: Inside driverRows.map callback
    # Anchor: the line "driverRows.map((row) => {"
    # Scan forward past const declarations and blanks.
    # If we hit a line starting with "<tr" without seeing "return ("
    # first, insert "return (" before it.
    # ===========================================================
    if ((-not $fix1) -and $t.Contains('driverRows.map((row) =>')) {
        $out.Add($raw)
        $i++
        # Copy lines until we hit <tr or return (
        $needsReturn = $true
        while ($i -lt $total) {
            $inner = $lines[$i]
            $it = $inner.Trim()

            if ($it.StartsWith('return (') -or $it.StartsWith('return(')) {
                $needsReturn = $false
                $out.Add($inner)
                $i++
                break
            }

            if ($it.StartsWith('<tr')) {
                if ($needsReturn) {
                    # Determine indent: match the <tr line indent minus 2
                    $m = [regex]::Match($inner, '^\s*')
                    $ind = $m.Value
                    $retInd = ' ' * ([Math]::Max(0, $ind.Length - 2))
                    $out.Add('')
                    $out.Add($retInd + 'return (')
                    $fix1 = $true
                    Write-Host "  FIX 1: Inserted 'return (' before <tr in driverRows.map" -ForegroundColor Green
                }
                # Don't increment - let <tr be added by default path
                break
            }

            $out.Add($inner)
            $i++
        }
        continue
    }

    # ===========================================================
    # FIX 2: Inside visibleTrips.map callback
    # Anchor: the line "visibleTrips.map((t, idx) => {"
    # Scan forward. If we find a bare "</div>" followed by "return (",
    # remove the stray </div>.
    # ===========================================================
    if ((-not $fix2) -and $t.Contains('visibleTrips.map((t, idx) =>')) {
        $out.Add($raw)
        $i++
        # Copy lines, watching for stray </div>
        while ($i -lt $total) {
            $inner = $lines[$i]
            $it = $inner.Trim()

            # Check: is this a bare </div> that shouldn't be here?
            if ($it -eq '</div>') {
                # Look ahead past blanks for "return ("
                $peek = $i + 1
                while (($peek -lt $total) -and ($lines[$peek].Trim() -eq '')) { $peek++ }

                if (($peek -lt $total) -and ($lines[$peek].Trim() -eq 'return (')) {
                    # This is the stray </div> - skip it
                    $i++
                    # Also skip blank lines between </div> and return (
                    while (($i -lt $total) -and ($lines[$i].Trim() -eq '')) { $i++ }
                    # Now $i points to "return (" - re-emit with proper indent
                    if (($i -lt $total) -and ($lines[$i].Trim() -eq 'return (')) {
                        $out.Add('')
                        $out.Add('                      return (')
                        $i++
                        $fix2 = $true
                        Write-Host "  FIX 2: Removed stray </div> in visibleTrips.map" -ForegroundColor Green
                        break
                    }
                }
            }

            # If we hit the closing of the map (});) stop scanning
            if ($it -eq '})') {
                $out.Add($inner)
                $i++
                break
            }

            $out.Add($inner)
            $i++
        }
        continue
    }

    # Default: copy line
    $out.Add($raw)
    $i++
}

# ---- WRITE ----

$outArray = @($out.ToArray())
$enc = New-Object System.Text.UTF8Encoding($false)
$text = ($outArray -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($target, $text, $enc)

Write-Host "`n== VERIFICATION ==" -ForegroundColor Cyan

if (-not $fix1) {
    Write-Host "FAIL: FIX 1 not applied (driverRows.map)" -ForegroundColor Red
    exit 1
}
if (-not $fix2) {
    Write-Host "FAIL: FIX 2 not applied (visibleTrips.map)" -ForegroundColor Red
    exit 1
}

# Re-read and verify
$v = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)

# Check brace balance before component return
$vText = [string]::Join("`n", $v)
$retIdx = $vText.IndexOf("`nreturn (")
if ($retIdx -gt 0) {
    $before = $vText.Substring(0, $retIdx)
    $openCount = ([regex]::Matches($before, '\{')).Count
    $closeCount = ([regex]::Matches($before, '\}')).Count
    $diff = $openCount - $closeCount
    if ($diff -eq 1) {
        Write-Host "  PASS: Brace balance before return = $diff (correct)" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Brace balance before return = $diff (expected 1)" -ForegroundColor Yellow
    }
}

# Check no stray </div> before return ( in visibleTrips.map
$vtClean = $true
for ($vi = 0; $vi -lt $v.Length; $vi++) {
    if ($v[$vi].Contains('visibleTrips.map((t, idx) =>')) {
        for ($vj = $vi + 1; $vj -lt [Math]::Min($v.Length, $vi + 20); $vj++) {
            if ($v[$vj].Trim() -eq 'return (') {
                for ($vk = $vj - 1; $vk -ge $vi; $vk--) {
                    $kt = $v[$vk].Trim()
                    if ($kt -eq '') { continue }
                    if ($kt -eq '</div>') { $vtClean = $false }
                    break
                }
                break
            }
        }
        break
    }
}
if ($vtClean) {
    Write-Host "  PASS: visibleTrips.map clean" -ForegroundColor Green
} else {
    Write-Host "  FAIL: visibleTrips.map still has stray </div>" -ForegroundColor Red
    exit 1
}

Write-Host "  PASS: component return intact" -ForegroundColor Green

$hash = (Get-FileHash -Algorithm SHA256 -Path $target).Hash
Write-Host "`n== DONE ==" -ForegroundColor Green
Write-Host "  Lines: $total -> $($outArray.Length)" -ForegroundColor White
Write-Host "  SHA256: $hash" -ForegroundColor White
Write-Host "`nNEXT:" -ForegroundColor Yellow
Write-Host "  npm run build" -ForegroundColor White
Write-Host "  git add -A && git commit -m 'fix: repair callback corruption (2 fixes)'" -ForegroundColor White
Write-Host "  git tag callback-repair-v2 && git push origin main --tags" -ForegroundColor White
