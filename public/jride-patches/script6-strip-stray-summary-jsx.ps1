# ============================================================
# SCRIPT 6 - STRIP STRAY SUMMARY JSX + CALLBACK REPAIR
# ============================================================
# Repairs app/admin/livetrips/LiveTripsClient.tsx by:
#   FIX 1: inserting missing "return (" before <tr in driverRows.map
#   FIX 2: removing stray </div> before return ( in visibleTrips.map
#   FIX 3: removing stray raw JSX summary blocks injected into executable code
#          (e.g. "SUPPLY SUMMARY", "Eligible:", "Stale:")
#
# PowerShell 5 safe | UTF-8 no BOM | Timestamped backup
# ============================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail([string]$Message) {
    throw $Message
}

function Write-Utf8NoBom([string]$Path, [string[]]$Lines) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $text = (($Lines -join "`r`n") + "`r`n")
    [System.IO.File]::WriteAllText($Path, $text, $enc)
}

function Count-Regex([string]$Text, [string]$Pattern) {
    return ([regex]::Matches($Text, $Pattern)).Count
}

# ---- LOCATE TARGET ----

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
    (Split-Path -Parent (Split-Path -Parent $scriptDir)),
    $scriptDir
)

$repoRoot = $null
foreach ($cand in $candidates) {
    if (-not $cand) { continue }
    $probe = Join-Path $cand "app\admin\livetrips\LiveTripsClient.tsx"
    if (Test-Path -LiteralPath $probe) {
        $repoRoot = $cand
        break
    }
}

if (-not $repoRoot) {
    Fail "Could not locate repository root containing app\\admin\\livetrips\\LiveTripsClient.tsx"
}

$target = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) {
    Fail ("Target not found: " + $target)
}

Write-Host "TARGET: $target" -ForegroundColor Cyan

# ---- BACKUP ----

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $repoRoot ("_backups\script6-strip-stray-summary-jsx-" + $timestamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir "LiveTripsClient.tsx.bak") -Force
Write-Host "BACKUP: $backupDir" -ForegroundColor Green

# ---- READ ----

$lines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$result = New-Object 'System.Collections.Generic.List[string]'
Write-Host "READ: $($lines.Length) lines" -ForegroundColor Cyan

# ---- PATCH ----

$fix1Applied = $false
$fix1Already = $false
$fix2Applied = $false
$fix2Already = $false
$summaryBlocksRemoved = 0
$i = 0

while ($i -lt $lines.Length) {
    $line = $lines[$i]
    $trimmed = $line.Trim()

    # ------------------------------------------------------------
    # FIX 3: Remove stray raw JSX summary block anywhere in executable code
    # Anchors observed in corrupted files:
    #   {/* SUPPLY SUMMARY */}
    #   <div className="mb-4 grid grid-cols-5 gap-2 text-sm">
    # with inner labels like Eligible:, Stale:, Active Trips:, Waiting Trips:
    # ------------------------------------------------------------
    $isSummaryStart = $false

    if ($trimmed -match 'SUPPLY SUMMARY') {
        $isSummaryStart = $true
    }
    elseif ($trimmed -eq '<div className="mb-4 grid grid-cols-5 gap-2 text-sm">') {
        $lookahead = [string]::Join("`n", $lines[[Math]::Min($i, $lines.Length-1)..[Math]::Min($i + 20, $lines.Length-1)])
        if ($lookahead -match 'Eligible:' -or $lookahead -match 'Stale:' -or $lookahead -match 'Active Trips:' -or $lookahead -match 'Waiting Trips:') {
            $isSummaryStart = $true
        }
    }

    if ($isSummaryStart) {
        $removedAt = $i + 1
        $sawOuterDiv = $false
        $depth = 0

        while ($i -lt $lines.Length) {
            $current = $lines[$i]
            $ct = $current.Trim()

            $openDivs = Count-Regex $ct '<div\b'
            $closeDivs = Count-Regex $ct '</div>'

            if (-not $sawOuterDiv) {
                if ($openDivs -gt 0) {
                    $sawOuterDiv = $true
                    $depth += $openDivs
                    $depth -= $closeDivs
                }
                $i++
                continue
            }

            $depth += $openDivs
            $depth -= $closeDivs
            $i++

            if ($depth -le 0) {
                break
            }
        }

        while ($i -lt $lines.Length -and $lines[$i].Trim() -eq '') {
            $i++
        }

        $summaryBlocksRemoved++
        Write-Host ("  FIX 3: Removed stray summary JSX block near line " + $removedAt) -ForegroundColor Green
        continue
    }

    # ------------------------------------------------------------
    # FIX 1: driverRows.map - ensure explicit return ( before first <tr
    # ------------------------------------------------------------
    if ($trimmed.Contains('driverRows.map((row) => {')) {
        $result.Add($line)
        $i++

        while ($i -lt $lines.Length) {
            $inner = $lines[$i]
            $innerTrim = $inner.Trim()

            if ($innerTrim -eq 'return (') {
                $fix1Already = $true
                $result.Add($inner)
                $i++
                break
            }

            if ($innerTrim.StartsWith('<tr')) {
                $m = [regex]::Match($inner, '^\s*')
                $trIndent = $m.Value
                $retIndent = ' ' * ([Math]::Max(0, $trIndent.Length - 2))
                $result.Add('')
                $result.Add($retIndent + 'return (')
                $fix1Applied = $true
                Write-Host "  FIX 1: Inserted return ( before <tr in driverRows.map" -ForegroundColor Green
                break
            }

            $result.Add($inner)
            $i++
        }
        continue
    }

    # ------------------------------------------------------------
    # FIX 2: visibleTrips.map - remove stray </div> before return (
    # ------------------------------------------------------------
    if ($trimmed.Contains('visibleTrips.map((t, idx) => {')) {
        $result.Add($line)
        $i++

        while ($i -lt $lines.Length) {
            $inner = $lines[$i]
            $innerTrim = $inner.Trim()

            if ($innerTrim -eq 'return (') {
                $fix2Already = $true
                $result.Add($inner)
                $i++
                break
            }

            if ($innerTrim -eq '</div>') {
                $peek = $i + 1
                while ($peek -lt $lines.Length -and $lines[$peek].Trim() -eq '') {
                    $peek++
                }

                if ($peek -lt $lines.Length -and $lines[$peek].Trim() -eq 'return (') {
                    $result.Add('')
                    $result.Add($lines[$peek])
                    $i = $peek + 1
                    $fix2Applied = $true
                    Write-Host "  FIX 2: Removed stray </div> in visibleTrips.map" -ForegroundColor Green
                    break
                }
            }

            $result.Add($inner)
            $i++
        }
        continue
    }

    $result.Add($line)
    $i++
}

# ---- WRITE ----

$outLines = @($result.ToArray())
Write-Utf8NoBom $target $outLines

# ---- VERIFY ----

Write-Host "`n== VERIFICATION ==" -ForegroundColor Cyan

$verifyLines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$verifyText = [string]::Join("`n", $verifyLines)

# Verify FIX 1
$driverMapOk = $false
for ($vi = 0; $vi -lt $verifyLines.Length; $vi++) {
    if ($verifyLines[$vi].Contains('driverRows.map((row) => {')) {
        for ($vj = $vi + 1; $vj -lt [Math]::Min($verifyLines.Length, $vi + 20); $vj++) {
            if ($verifyLines[$vj].Trim().StartsWith('<tr')) {
                for ($vk = $vj - 1; $vk -ge $vi; $vk--) {
                    $kt = $verifyLines[$vk].Trim()
                    if ($kt -eq '') { continue }
                    if ($kt -eq 'return (') { $driverMapOk = $true }
                    break
                }
                break
            }
        }
        break
    }
}
if (-not $driverMapOk) {
    Fail "VERIFY FAILED: driverRows.map still missing return ( before <tr"
}
Write-Host "  PASS: driverRows.map has explicit return (" -ForegroundColor Green

# Verify FIX 2
$tripMapOk = $true
for ($vi = 0; $vi -lt $verifyLines.Length; $vi++) {
    if ($verifyLines[$vi].Contains('visibleTrips.map((t, idx) => {')) {
        for ($vj = $vi + 1; $vj -lt [Math]::Min($verifyLines.Length, $vi + 25); $vj++) {
            if ($verifyLines[$vj].Trim() -eq 'return (') {
                for ($vk = $vj - 1; $vk -ge $vi; $vk--) {
                    $kt = $verifyLines[$vk].Trim()
                    if ($kt -eq '') { continue }
                    if ($kt -eq '</div>') { $tripMapOk = $false }
                    break
                }
                break
            }
        }
        break
    }
}
if (-not $tripMapOk) {
    Fail "VERIFY FAILED: visibleTrips.map still has stray </div> before return ("
}
Write-Host "  PASS: visibleTrips.map clean" -ForegroundColor Green

# Verify FIX 3
if ($verifyText -match 'SUPPLY SUMMARY') {
    Fail "VERIFY FAILED: stray SUPPLY SUMMARY marker still present"
}
if ($verifyText -match 'Eligible:\s*\{drivers\.filter') {
    Fail "VERIFY FAILED: stray Eligible summary JSX still present"
}
if ($verifyText -match 'Stale:\s*\{drivers\.filter') {
    Fail "VERIFY FAILED: stray Stale summary JSX still present"
}
if ($verifyText -match 'Active Trips:\s*\{allTrips\.filter') {
    Fail "VERIFY FAILED: stray Active Trips summary JSX still present"
}
if ($verifyText -match 'Waiting Trips:\s*\{allTrips\.filter') {
    Fail "VERIFY FAILED: stray Waiting Trips summary JSX still present"
}
Write-Host "  PASS: no stray raw JSX summary blocks remain" -ForegroundColor Green

# Verify component-level return and brace balance before it
$showLine = -1
for ($vi = 0; $vi -lt $verifyLines.Length; $vi++) {
    if ($verifyLines[$vi].Contains('const showThresholds =')) {
        $showLine = $vi
        break
    }
}
if ($showLine -lt 0) {
    Fail "VERIFY FAILED: could not locate const showThresholds anchor"
}

$returnLine = -1
for ($vi = $showLine + 1; $vi -lt $verifyLines.Length; $vi++) {
    if ($verifyLines[$vi].Trim() -eq 'return (') {
        $returnLine = $vi
        break
    }
}
if ($returnLine -lt 0) {
    Fail "VERIFY FAILED: component-level return ( not found"
}

$beforeText = [string]::Join("`n", $verifyLines[0..($returnLine-1)])
$openCount = Count-Regex $beforeText '\{'
$closeCount = Count-Regex $beforeText '\}'
$diff = $openCount - $closeCount
if ($diff -ne 1) {
    Fail ("VERIFY FAILED: brace balance before component return = " + $diff + " (expected 1)")
}
Write-Host "  PASS: component-level return intact" -ForegroundColor Green
Write-Host ("  PASS: brace balance before component return = " + $diff) -ForegroundColor Green

# ASCII guard
$nonAscii = [regex]::Match($verifyText, '[^\u0000-\u007F]')
if ($nonAscii.Success) {
    $code = [int][char]$nonAscii.Value
    Fail ("VERIFY FAILED: non-ASCII character U+" + ('{0:X4}' -f $code))
}
Write-Host "  PASS: ASCII-only" -ForegroundColor Green

# ---- SUMMARY ----

$hash = (Get-FileHash -Algorithm SHA256 -Path $target).Hash
Write-Host ''
Write-Host '== PATCH COMPLETE ==' -ForegroundColor Green
Write-Host ("  driverRows.map: " + ($(if ($fix1Applied) { 'patched' } elseif ($fix1Already) { 'already clean' } else { 'not seen' }))) -ForegroundColor White
Write-Host ("  visibleTrips.map: " + ($(if ($fix2Applied) { 'patched' } elseif ($fix2Already) { 'already clean' } else { 'not seen' }))) -ForegroundColor White
Write-Host ("  summary blocks removed: " + $summaryBlocksRemoved) -ForegroundColor White
Write-Host ("  Lines: " + $lines.Length + ' -> ' + $outLines.Length) -ForegroundColor White
Write-Host ("  SHA256: " + $hash) -ForegroundColor White
Write-Host ("  Backup: " + $backupDir) -ForegroundColor White
Write-Host ''
Write-Host 'RUN:' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script6-strip-stray-summary-jsx.ps1' -ForegroundColor White
Write-Host 'BUILD:' -ForegroundColor Yellow
Write-Host '  npm run build' -ForegroundColor White
Write-Host 'GIT:' -ForegroundColor Yellow
Write-Host '  git add -A' -ForegroundColor White
Write-Host '  git commit -m "fix: strip stray summary JSX and repair LiveTripsClient callbacks"' -ForegroundColor White
Write-Host '  git tag callback-repair-v3' -ForegroundColor White
Write-Host '  git push origin main --tags' -ForegroundColor White
