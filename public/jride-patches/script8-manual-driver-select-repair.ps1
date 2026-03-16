# ============================================================
# SCRIPT 8 - MANUAL DRIVER SELECT CALLBACK REPAIR
# ============================================================
# Repairs app/admin/livetrips/LiveTripsClient.tsx by fixing the
# manual driver <select> callback inside the "Assign driver (manual)"
# panel.
#
# Fixes:
#   1) remove stray </div> injected before return (
#   2) insert missing return ( before first <option if needed
#
# Target corruption observed near:
#   drivers.map((d, idx) => {
#     const id = ...
#     const label = ...
#     </div>
#     return (
#       <option ...>
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
$backupDir = Join-Path $repoRoot ("_backups\script8-manual-driver-select-repair-" + $timestamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir "LiveTripsClient.tsx.bak") -Force
Write-Host "BACKUP: $backupDir" -ForegroundColor Green

# ---- READ ----

$lines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$result = New-Object 'System.Collections.Generic.List[string]'
Write-Host "READ: $($lines.Length) lines" -ForegroundColor Cyan

# ---- PATCH ----

$panelSeen = $false
$fixApplied = $false
$fixAlready = $false
$i = 0

while ($i -lt $lines.Length) {
    $line = $lines[$i]
    $trimmed = $line.Trim()

    if ($trimmed.Contains('Assign driver (manual)')) {
        $panelSeen = $true
        $result.Add($line)
        $i++
        continue
    }

    if ($panelSeen -and $trimmed.Contains('drivers.map((d, idx) => {')) {
        $result.Add($line)
        $i++

        while ($i -lt $lines.Length) {
            $inner = $lines[$i]
            $innerTrim = $inner.Trim()

            if ($innerTrim -eq 'return (') {
                $fixAlready = $true
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
                    $fixApplied = $true
                    Write-Host "  FIX: Removed stray </div> in manual driver select callback" -ForegroundColor Green
                    break
                }
            }

            if ($innerTrim.StartsWith('<option')) {
                $m = [regex]::Match($inner, '^\s*')
                $optionIndent = $m.Value
                $returnIndent = ' ' * ([Math]::Max(0, $optionIndent.Length - 2))
                $result.Add('')
                $result.Add($returnIndent + 'return (')
                $fixApplied = $true
                Write-Host "  FIX: Inserted return ( before <option in manual driver select callback" -ForegroundColor Green
                break
            }

            $result.Add($inner)
            $i++
        }
        continue
    }

    $result.Add($line)
    $i++
}

if (-not $panelSeen) {
    Fail 'PATCH FAILED: could not locate "Assign driver (manual)" panel anchor'
}
if (-not $fixApplied -and -not $fixAlready) {
    Fail 'PATCH FAILED: manual driver select callback anchor found, but no repair point matched'
}

# ---- WRITE ----

$outLines = @($result.ToArray())
Write-Utf8NoBom $target $outLines

# ---- VERIFY ----

Write-Host "`n== VERIFICATION ==" -ForegroundColor Cyan

$verifyLines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$verifyText = [string]::Join("`n", $verifyLines)

$manualAnchor = -1
$mapAnchor = -1
for ($vi = 0; $vi -lt $verifyLines.Length; $vi++) {
    if ($manualAnchor -lt 0 -and $verifyLines[$vi].Contains('Assign driver (manual)')) {
        $manualAnchor = $vi
    }
    if ($manualAnchor -ge 0 -and $verifyLines[$vi].Contains('drivers.map((d, idx) => {')) {
        $mapAnchor = $vi
        break
    }
}

if ($manualAnchor -lt 0) {
    Fail 'VERIFY FAILED: manual panel anchor missing after patch'
}
if ($mapAnchor -lt 0) {
    Fail 'VERIFY FAILED: manual select callback anchor missing after patch'
}

$optionLine = -1
$returnLine = -1
$selectCloseLine = -1
for ($vi = $mapAnchor + 1; $vi -lt [Math]::Min($verifyLines.Length, $mapAnchor + 40); $vi++) {
    $t = $verifyLines[$vi].Trim()
    if ($returnLine -lt 0 -and $t -eq 'return (') {
        $returnLine = $vi
    }
    if ($optionLine -lt 0 -and $t.StartsWith('<option')) {
        $optionLine = $vi
    }
    if ($selectCloseLine -lt 0 -and $t -eq '</select>') {
        $selectCloseLine = $vi
    }
}

if ($returnLine -lt 0) {
    Fail 'VERIFY FAILED: return ( not found in manual select callback'
}
if ($optionLine -lt 0) {
    Fail 'VERIFY FAILED: <option not found in manual select callback'
}
if ($returnLine -ge $optionLine) {
    Fail 'VERIFY FAILED: return ( does not appear before <option in manual select callback'
}
if ($selectCloseLine -lt 0) {
    Fail 'VERIFY FAILED: </select> not found after manual select callback'
}
Write-Host '  PASS: manual select callback has return ( before <option' -ForegroundColor Green
Write-Host '  PASS: </select> present after callback' -ForegroundColor Green

for ($vi = $mapAnchor + 1; $vi -lt $returnLine; $vi++) {
    if ($verifyLines[$vi].Trim() -eq '</div>') {
        Fail 'VERIFY FAILED: stray </div> still present before return ( in manual select callback'
    }
}
Write-Host '  PASS: no stray </div> remains before return (' -ForegroundColor Green

$nonAscii = [regex]::Match($verifyText, '[^\u0000-\u007F]')
if ($nonAscii.Success) {
    $code = [int][char]$nonAscii.Value
    Fail ("VERIFY FAILED: non-ASCII character U+" + ('{0:X4}' -f $code))
}
Write-Host '  PASS: ASCII-only' -ForegroundColor Green

# ---- SUMMARY ----

$hash = (Get-FileHash -Algorithm SHA256 -Path $target).Hash
Write-Host ''
Write-Host '== PATCH COMPLETE ==' -ForegroundColor Green
Write-Host ('  manual driver select callback: ' + ($(if ($fixApplied) { 'patched' } else { 'already clean' }))) -ForegroundColor White
Write-Host ('  Lines: ' + $lines.Length + ' -> ' + $outLines.Length) -ForegroundColor White
Write-Host ('  SHA256: ' + $hash) -ForegroundColor White
Write-Host ('  Backup: ' + $backupDir) -ForegroundColor White
Write-Host ''
Write-Host 'RUN:' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script8-manual-driver-select-repair.ps1' -ForegroundColor White
Write-Host 'BUILD:' -ForegroundColor Yellow
Write-Host '  npm run build' -ForegroundColor White
