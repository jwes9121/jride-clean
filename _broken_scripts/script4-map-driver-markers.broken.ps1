# ============================================================
# SCRIPT 4 — MAP DRIVER MARKERS — FULL REWRITE
# SCRIPT 4 - MAP DRIVER MARKERS - CLEAN REPLACEMENT
# ============================================================
# Purpose:
#   1) Remove ALL stray raw JSX blocks from LiveTripsClient.tsx
#      that sit outside return() and break compilation.
#   2) Fix corrupted standalone-driver-markers cleanup block
#      in LiveTripsMap.tsx (PowerShell syntax leaked into JS).
#   3) Ensure drivers={drivers} prop is passed to LiveTripsMap.
#   4) Ensure standalone driver markers useEffect is intact.
#   1) Repair LiveTripsClient.tsx by removing all injected raw JSX
#      summary blocks that sit inside executable code and break TSX.
#   2) Ensure LiveTripsClient passes the dedicated drivers dataset
#      into LiveTripsMap using the file's actual JSX structure.
#   3) Repair LiveTripsMap.tsx so standalone driver markers render
#      from the drivers dataset independently from trip-derived data.
#   4) Repair any prior corruption in the standalone driver marker
#      useEffect cleanup block.
#
# Files patched:
#   app/admin/livetrips/LiveTripsClient.tsx
#   app/admin/livetrips/components/LiveTripsMap.tsx
# Scope:
#   - app/admin/livetrips/LiveTripsClient.tsx
#   - app/admin/livetrips/components/LiveTripsMap.tsx
#
# RUN:
#   powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script4-map-driver-markers.ps1
# Safety:
#   - PowerShell 5 safe
#   - UTF-8 without BOM writes
#   - Timestamped backups
#   - Loud aborts on missing anchors
#   - Idempotent re-run behavior
# ============================================================
$ErrorActionPreference = "Stop"
$repoRoot   = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$clientFile = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"
$mapFile    = Join-Path $repoRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
# ================================================================
# PRE-FLIGHT
# ================================================================
Write-Host ""
Write-Host "=== Script 4: Map Driver Markers ===" -ForegroundColor Cyan
Write-Host ""
if (-not (Test-Path $clientFile)) {
    Write-Error "ABORT: LiveTripsClient.tsx not found at $clientFile"
    exit 1
}
if (-not (Test-Path $mapFile)) {
    Write-Error "ABORT: LiveTripsMap.tsx not found at $mapFile"
    exit 1
}
Write-Host "  OK: Both target files exist" -ForegroundColor Green
# ================================================================
# BACKUPS
# ================================================================
$ts     = Get-Date -Format "yyyyMMdd-HHmmss"
$bakDir = Join-Path $repoRoot "_backups\script4-$ts"
New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
Copy-Item $clientFile (Join-Path $bakDir "LiveTripsClient.tsx.bak")
Copy-Item $mapFile    (Join-Path $bakDir "LiveTripsMap.tsx.bak")
Write-Host "  BACKUPS saved to $bakDir" -ForegroundColor Green
# ================================================================
# PATCH 1: LiveTripsClient.tsx — remove stray JSX blocks
# ================================================================
Write-Host ""
Write-Host "--- Patching LiveTripsClient.tsx ---" -ForegroundColor Cyan
$clientLines = [System.IO.File]::ReadAllLines($clientFile, [System.Text.Encoding]::UTF8)
$origClientCount = $clientLines.Length
Write-Host "  Read $origClientCount lines" -ForegroundColor White
# The stray blocks all start with a line containing:
#   <div className="p-2 border rounded">
# followed by lines containing "Eligible:", "Stale:", "Active Trips:", "Waiting Trips:"
# and end with a line that is just:  </div>
#
# These blocks appear in multiple places (inside useEffect, inside .map callbacks, etc.)
# They are always OUTSIDE a valid return() and therefore break compilation.
#
# Strategy: scan line by line. When we see a line matching the start of a stray block,
# skip lines until we pass the closing </div>. The stray blocks are always exactly
# 13 lines (the pattern repeats identically each time):
#
#   <blank or whitespace>
#   <div className="p-2 border rounded">
#       Eligible: {drivers.filter(d => d.assign_eligible).length}
#     </div>
#     <div className="p-2 border rounded">
#       Stale: {drivers.filter(d => d.is_stale).length}
#     </div>
#     <div className="p-2 border rounded">
#       Active Trips: {allTrips.filter(t => t.status === "on_trip").length}
#     </div>
#     <div className="p-2 border rounded">
#       Waiting Trips: {allTrips.filter(t => t.status === "requested").length}
#     </div>
#   </div>
#
# We detect the start by: line contains '<div className="p-2 border rounded">'
# AND a nearby subsequent line contains 'Eligible:' or 'drivers.filter'.
# We then skip until we hit the final standalone </div> line.
$cleanLines = New-Object System.Collections.Generic.List[string]
$i = 0
$removedBlocks = 0
while ($i -lt $clientLines.Length) {
    $line = $clientLines[$i]
    $trimmed = $line.Trim()
    # Detect start of stray block
    $isStrayStart = $false
    if ($trimmed -eq '<div className="p-2 border rounded">') {
        # Look ahead: does one of the next 3 lines contain "Eligible:"?
        for ($peek = $i + 1; $peek -lt [Math]::Min($i + 4, $clientLines.Length); $peek++) {
            if ($clientLines[$peek].Contains("Eligible:")) {
                $isStrayStart = $true
Set-StrictMode -Version Latest
function Write-Step([string]$Message) {
    Write-Host "`n== $Message ==" -ForegroundColor Cyan
}
function Write-Ok([string]$Message) {
    Write-Host "  OK: $Message" -ForegroundColor Green
}
function Write-WarnMsg([string]$Message) {
    Write-Host "  WARN: $Message" -ForegroundColor Yellow
}
function Fail([string]$Message) {
    throw $Message
}
function Read-Utf8Lines([string]$Path) {
    return [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
}
function Join-Lines([string[]]$Lines) {
    return (($Lines -join "`r`n") + "`r`n")
}
function Write-Utf8NoBom([string]$Path, [string]$Content) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}
function Backup-File([string]$SourcePath, [string]$BackupDir) {
    $leaf = Split-Path -Leaf $SourcePath
    $dest = Join-Path $BackupDir ($leaf + ".bak")
    Copy-Item -Path $SourcePath -Destination $dest -Force
    return $dest
}
function Assert-FileExists([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "ABORT: required file not found: $Path"
    }
}
function Assert-Anchors([string]$Text, [string[]]$Anchors, [string]$Label) {
    foreach ($anchor in $Anchors) {
        if (-not $Text.Contains($anchor)) {
            Fail "ABORT: $Label is missing required anchor: $anchor"
        }
    }
}
function Assert-AsciiText([string]$Text, [string]$Label) {
    $m = [regex]::Match($Text, "[^\u0000-\u007F]")
    if ($m.Success) {
        $code = [int][char]$m.Value
        Fail "ABORT: $Label contains non-ASCII character U+$('{0:X4}' -f $code)"
    }
}
function New-StringList([string[]]$Lines) {
    $list = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in $Lines) {
        [void]$list.Add([string]$line)
    }
    return $list
}
function Remove-StraySummaryBlocks([string[]]$Lines) {
    $out = New-Object 'System.Collections.Generic.List[string]'
    $i = 0
    $removed = 0
    while ($i -lt $Lines.Length) {
        $matched = $false
        if ($i + 12 -lt $Lines.Length) {
            $t0  = $Lines[$i].Trim()
            $t1  = $Lines[$i + 1].Trim()
            $t2  = $Lines[$i + 2].Trim()
            $t3  = $Lines[$i + 3].Trim()
            $t4  = $Lines[$i + 4].Trim()
            $t5  = $Lines[$i + 5].Trim()
            $t6  = $Lines[$i + 6].Trim()
            $t7  = $Lines[$i + 7].Trim()
            $t8  = $Lines[$i + 8].Trim()
            $t9  = $Lines[$i + 9].Trim()
            $t10 = $Lines[$i + 10].Trim()
            $t11 = $Lines[$i + 11].Trim()
            $t12 = $Lines[$i + 12].Trim()
            $looksLikeInjectedBlock = (
                $t0  -eq '<div className="p-2 border rounded">' -and
                $t1  -like 'Eligible:*' -and
                $t2  -eq '</div>' -and
                $t3  -eq '<div className="p-2 border rounded">' -and
                $t4  -like 'Stale:*' -and
                $t5  -eq '</div>' -and
                $t6  -eq '<div className="p-2 border rounded">' -and
                $t7  -like 'Active Trips:*' -and
                $t8  -eq '</div>' -and
                $t9  -eq '<div className="p-2 border rounded">' -and
                $t10 -like 'Waiting Trips:*' -and
                $t11 -eq '</div>' -and
                $t12 -eq '</div>'
            )
            if ($looksLikeInjectedBlock) {
                $removed++
                $i += 13
                $matched = $true
            }
        }
        if ($matched) {
            continue
        }
        [void]$out.Add($Lines[$i])
        $i++
    }
    return @{
        Lines   = $out.ToArray()
        Removed = $removed
    }
}
function Ensure-LiveTripsMapDriversProp([string[]]$Lines) {
    $list = New-StringList $Lines
    $start = -1
    $end = -1
    for ($i = 0; $i -lt $list.Count; $i++) {
        if ($start -eq -1 -and $list[$i] -match '<LiveTripsMap\b') {
            $start = $i
        }
        if ($start -ne -1) {
            if ($list[$i].Contains('/>') -or $list[$i].Trim().EndsWith('>')) {
                $end = $i
                break
            }
        }
    }
    if ($isStrayStart) {
        # Skip forward through the entire stray block.
        # Count nested divs to find the final </div>
        $divDepth = 0
        $blockStart = $i
        while ($i -lt $clientLines.Length) {
            $cur = $clientLines[$i].Trim()
            # Count opening divs
            if ($cur -match '^<div\b') { $divDepth++ }
            # Count closing divs
            if ($cur -eq '</div>') { $divDepth-- }
            $i++
            # When depth returns to 0, the block is fully closed
            if ($divDepth -le 0 -and $i -gt $blockStart) { break }
        }
        $removedBlocks++
        $blockSize = $i - $blockStart
        Write-Host "  REMOVED stray block #$removedBlocks at line $($blockStart + 1) ($blockSize lines)" -ForegroundColor Green
        continue
    }
    $cleanLines.Add($line)
    $i++
}
if ($removedBlocks -eq 0) {
    Write-Host "  No stray JSX blocks found (file may already be clean)" -ForegroundColor Yellow
    if ($start -lt 0 -or $end -lt 0) {
        Fail 'ABORT: could not locate <LiveTripsMap ...> opening tag in LiveTripsClient.tsx'
    }
    $tagLines = @()
    for ($i = $start; $i -le $end; $i++) {
        $tagLines += $list[$i]
    }
    $tagText = $tagLines -join "`n"
    if ($tagText.Contains('drivers={drivers as any}')) {
        for ($i = $start; $i -le $end; $i++) {
            $list[$i] = $list[$i].Replace('drivers={drivers as any}', 'drivers={drivers}')
        }
        return $list.ToArray()
    }
    if ([regex]::IsMatch($tagText, 'drivers\s*=\s*\{')) {
        return $list.ToArray()
    }
    if ($start -eq $end) {
        if ($list[$start].Contains('selectedTripId=')) {
            $list[$start] = $list[$start].Replace('selectedTripId={', 'drivers={drivers} selectedTripId={')
        } elseif ($list[$start].Contains('/>')) {
            $list[$start] = $list[$start].Replace('/>', ' drivers={drivers} />')
        } else {
            Fail 'ABORT: could not inject drivers prop into single-line <LiveTripsMap> tag'
        }
        return $list.ToArray()
    }
    $indent = ''
    if ($start + 1 -le $end) {
        $indent = ([regex]::Match($list[$start + 1], '^\s*')).Value
    }
    if ([string]::IsNullOrWhiteSpace($indent)) {
        $indent = (([regex]::Match($list[$start], '^\s*')).Value + '  ')
    }
    $list.Insert($start + 1, ($indent + 'drivers={drivers}'))
    return $list.ToArray()
}
function Ensure-DriversPropInMapInterface([string[]]$Lines) {
    $list = New-StringList $Lines
    $ifaceStart = -1
    $ifaceEnd = -1
    for ($i = 0; $i -lt $list.Count; $i++) {
        if ($ifaceStart -eq -1 -and $list[$i].Contains('export interface LiveTripsMapProps')) {
            $ifaceStart = $i
            continue
        }
        if ($ifaceStart -ne -1 -and $list[$i].Trim() -eq '}') {
            $ifaceEnd = $i
            break
        }
    }
    if ($ifaceStart -lt 0 -or $ifaceEnd -lt 0) {
        Fail 'ABORT: could not locate LiveTripsMapProps interface block'
    }
    $blockLines = @()
    for ($i = $ifaceStart; $i -le $ifaceEnd; $i++) {
        $blockLines += $list[$i]
    }
    $blockText = $blockLines -join "`n"
    if ([regex]::IsMatch($blockText, 'drivers\?\s*:')) {
        return $list.ToArray()
    }
    for ($i = $ifaceStart + 1; $i -lt $ifaceEnd; $i++) {
        if ($list[$i] -match '^\s*trips\s*:') {
            $indent = ([regex]::Match($list[$i], '^\s*')).Value
            $list.Insert($i + 1, ($indent + 'drivers?: DriverLocation[];'))
            return $list.ToArray()
        }
    }
    Fail 'ABORT: could not find trips property inside LiveTripsMapProps interface'
}
function Ensure-DriversDefaultInMapComponent([string[]]$Lines) {
    $list = New-StringList $Lines
    $start = -1
    $end = -1
    for ($i = 0; $i -lt $list.Count; $i++) {
        if ($start -eq -1 -and $list[$i].Contains('export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({')) {
            $start = $i
            continue
        }
        if ($start -ne -1 -and $list[$i].Contains('}) => {')) {
            $end = $i
            break
        }
    }
    if ($start -lt 0 -or $end -lt 0) {
        Fail 'ABORT: could not locate LiveTripsMap component parameter block'
    }
    $blockLines = @()
    for ($i = $start; $i -le $end; $i++) {
        $blockLines += $list[$i]
    }
    $blockText = $blockLines -join "`n"
    if ([regex]::IsMatch($blockText, 'drivers\s*=\s*\[\]')) {
        return $list.ToArray()
    }
    for ($i = $start; $i -le $end; $i++) {
        if ($list[$i] -match '^\s*drivers\s*,$') {
            $indent = ([regex]::Match($list[$i], '^\s*')).Value
            $list[$i] = $indent + 'drivers = [],'
            return $list.ToArray()
        }
    }
    for ($i = $start; $i -le $end; $i++) {
        if ($list[$i] -match '^\s*trips\s*,$') {
            $indent = ([regex]::Match($list[$i], '^\s*')).Value
            $list.Insert($i + 1, ($indent + 'drivers = [],'))
            return $list.ToArray()
        }
    }
    Fail 'ABORT: could not inject drivers default into LiveTripsMap component parameters'
}
function Replace-SectionByAnchors([string[]]$Lines, [string]$StartAnchor, [string]$EndAnchor, [string[]]$Replacement, [string]$Label) {
    $start = -1
    $end = -1
    for ($i = 0; $i -lt $Lines.Length; $i++) {
        if ($start -eq -1 -and $Lines[$i].Contains($StartAnchor)) {
            $start = $i
            continue
        }
        if ($start -ne -1 -and $Lines[$i].Contains($EndAnchor)) {
            $end = $i
            break
        }
    }
    if ($start -lt 0 -or $end -lt 0 -or $end -le $start) {
        Fail "ABORT: could not locate section anchors for $Label"
    }
    $result = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $start; $i++) {
        [void]$result.Add($Lines[$i])
    }
    foreach ($line in $Replacement) {
        [void]$result.Add($line)
    }
    for ($i = $end; $i -lt $Lines.Length; $i++) {
        [void]$result.Add($Lines[$i])
    }
    return $result.ToArray()
}
Write-Step 'Locate repository and target files'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$clientFile = Join-Path $repoRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$mapFile = Join-Path $repoRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
Assert-FileExists $clientFile
Assert-FileExists $mapFile
Write-Ok 'Target files exist'
Write-Step 'Create timestamped backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $repoRoot (Join-Path '_backups' ('script4-map-driver-markers-' + $timestamp))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$clientBackup = Backup-File -SourcePath $clientFile -BackupDir $backupDir
$mapBackup = Backup-File -SourcePath $mapFile -BackupDir $backupDir
Write-Ok ('Client backup: ' + $clientBackup)
Write-Ok ('Map backup: ' + $mapBackup)
Write-Step 'Read current files from disk'
$clientLines = Read-Utf8Lines $clientFile
$mapLines = Read-Utf8Lines $mapFile
$clientText = Join-Lines $clientLines
$mapText = Join-Lines $mapLines
Write-Step 'Validate required anchors before patching'
Assert-Anchors -Text $clientText -Label 'LiveTripsClient.tsx' -Anchors @(
    'export default function LiveTripsClient() {',
    'async function loadDrivers() {',
    'const driverRows = useMemo(() => {',
    'SmartAutoAssignSuggestions',
    '<LiveTripsMap'
)
Assert-Anchors -Text $mapText -Label 'LiveTripsMap.tsx' -Anchors @(
    'export type DriverLocation = {',
    'export interface LiveTripsMapProps {',
    'const standaloneDriverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});',
    '// ===== STANDALONE DRIVER MARKERS (independent from trip data) =====',
    '// ===== AUTO-FOLLOW ====='
)
Write-Ok 'All required anchors found'
Write-Step 'Patch LiveTripsClient.tsx in memory'
$clientPatch = Remove-StraySummaryBlocks $clientLines
$patchedClientLines = $clientPatch.Lines
$removedBlocks = [int]$clientPatch.Removed
$patchedClientLines = Ensure-LiveTripsMapDriversProp $patchedClientLines
$patchedClientText = Join-Lines $patchedClientLines
Assert-AsciiText -Text $patchedClientText -Label 'Patched LiveTripsClient.tsx'
if ($removedBlocks -gt 0) {
    Write-Ok ("Removed stray raw JSX blocks: $removedBlocks")
} else {
    Write-Host "  Total stray blocks removed: $removedBlocks" -ForegroundColor Green
}
# ---- Ensure drivers={drivers} is on <LiveTripsMap ----
$clientJoined = $cleanLines -join "`n"
if ($clientJoined.Contains("drivers={drivers")) {
    Write-Host "  OK: drivers prop already present on <LiveTripsMap" -ForegroundColor Green
} elseif ($clientJoined.Contains("<LiveTripsMap")) {
    # Find the <LiveTripsMap line and add drivers prop
    for ($j = 0; $j -lt $cleanLines.Count; $j++) {
        if ($cleanLines[$j].Contains("<LiveTripsMap")) {
            $origLine = $cleanLines[$j]
            # Insert drivers={drivers as any} before the closing />
            if ($origLine.Contains("/>")) {
                $cleanLines[$j] = $origLine.Replace("/>", "drivers={drivers as any} />")
                Write-Host "  INSERTED drivers={drivers} into <LiveTripsMap (same line)" -ForegroundColor Green
            } else {
                # Multi-line JSX tag — add on next available prop line
                $cleanLines.Insert($j + 1, "          drivers={drivers as any}")
                Write-Host "  INSERTED drivers={drivers} into <LiveTripsMap (new line)" -ForegroundColor Green
            }
            break
        }
    }
} else {
    Write-Host "  WARN: <LiveTripsMap tag not found in file" -ForegroundColor Yellow
}
# ---- Write cleaned client file ----
$finalClientContent = $cleanLines -join "`n"
[System.IO.File]::WriteAllText(
    $clientFile,
    $finalClientContent,
    (New-Object System.Text.UTF8Encoding $false)
    Write-WarnMsg 'No stray raw JSX blocks were found; file may already be clean'
}
Write-Step 'Patch LiveTripsMap.tsx in memory'
$patchedMapLines = Ensure-DriversPropInMapInterface $mapLines
$patchedMapLines = Ensure-DriversDefaultInMapComponent $patchedMapLines
$standaloneDriverSection = @(
'  // ===== STANDALONE DRIVER MARKERS (independent from trip data) =====',
'  useEffect(() => {',
'    const map = mapRef.current;',
'    if (!map || !mapReady) return;',
'',
'    const nextStandalone: Record<string, mapboxgl.Marker> = {};',
'',
'    for (const d of drivers ?? []) {',
'      const lat = num((d as any).lat);',
'      const lng = num((d as any).lng);',
'      if (lat == null || lng == null) continue;',
'',
'      const id = String((d as any).driver_id || "");',
'      if (!id) continue;',
'',
'      const statusLower = String((d as any).status ?? "").toLowerCase();',
'      const isStale = !!(d as any).is_stale;',
'      const isOnline = ["available", "online", "idle", "assigned", "on_the_way", "on_trip"].includes(statusLower);',
'',
'      let marker = standaloneDriverMarkersRef.current[id];',
'      if (!marker) {',
'        const el = document.createElement("div");',
'        el.style.width = "18px";',
'        el.style.height = "18px";',
'        el.style.borderRadius = "9999px";',
'        el.style.border = "2px solid #ffffff";',
'        el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";',
'        el.style.transform = "translate(-50%, -50%)";',
'        el.style.cursor = "pointer";',
'        el.style.backgroundColor = isStale ? "#94a3b8" : isOnline ? "#2563eb" : "#64748b";',
'        el.title = [',
'          (d as any).name ?? id,',
'          (d as any).status ?? "",',
'          (d as any).town ?? "",',
'        ].filter(Boolean).join(" | ");',
'',
'        marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map);',
'      } else {',
'        marker.setLngLat([lng, lat]);',
'        const el = marker.getElement();',
'        el.style.backgroundColor = isStale ? "#94a3b8" : isOnline ? "#2563eb" : "#64748b";',
'        el.title = [',
'          (d as any).name ?? id,',
'          (d as any).status ?? "",',
'          (d as any).town ?? "",',
'        ].filter(Boolean).join(" | ");',
'      }',
'',
'      nextStandalone[id] = marker;',
'    }',
'',
'    for (const [id, marker] of Object.entries(standaloneDriverMarkersRef.current)) {',
'      if (!nextStandalone[id]) {',
'        marker.remove();',
'      }',
'    }',
'',
'    standaloneDriverMarkersRef.current = nextStandalone;',
'  }, [drivers, mapReady]);'
)
Write-Host "  WROTE LiveTripsClient.tsx ($($cleanLines.Count) lines, was $origClientCount)" -ForegroundColor Green
# ================================================================
# PATCH 2: LiveTripsMap.tsx — fix corrupted driver markers cleanup
# ================================================================
Write-Host ""
Write-Host "--- Patching LiveTripsMap.tsx ---" -ForegroundColor Cyan
$mapLines = [System.IO.File]::ReadAllLines($mapFile, [System.Text.Encoding]::UTF8)
$origMapCount = $mapLines.Length
Write-Host "  Read $origMapCount lines" -ForegroundColor White
# ---- Validate required anchors ----
$mapJoined = $mapLines -join "`n"
$requiredMapAnchors = @(
    "LiveTripsMapProps",
    "standaloneDriverMarkersRef",
    "STANDALONE DRIVER"
)
foreach ($anchor in $requiredMapAnchors) {
    if (-not $mapJoined.Contains($anchor)) {
        Write-Error "ABORT: required anchor '$anchor' not found in LiveTripsMap.tsx"
        exit 1
    }
}
Write-Host "  OK: All required anchors found" -ForegroundColor Green
# ---- Check for DriverLocation type ----
if ($mapJoined.Contains("export type DriverLocation")) {
    Write-Host "  OK: DriverLocation type present" -ForegroundColor Green
} else {
    Write-Host "  WARN: DriverLocation type missing — may need manual fix" -ForegroundColor Yellow
}
# ---- Check for drivers prop ----
if ($mapJoined.Contains("drivers?:") -or $mapJoined.Contains("drivers =")) {
    Write-Host "  OK: drivers prop in interface/destructure" -ForegroundColor Green
} else {
    Write-Host "  WARN: drivers prop not found in interface" -ForegroundColor Yellow
}
# ---- Fix corrupted cleanup block ----
# Known corruption: the block between "nextStandalone[id] = marker;"
# and the AUTO-FOLLOW section contains PowerShell syntax "-not"
# and/or duplicate "}, [drivers, mapReady]);" closings.
#
# We find the corruption zone and replace it with correct JS.
$corruptionFound = $mapJoined.Contains("-not nextStandalone")
$duplicateClose  = $false
# Also check for duplicate }, [drivers, mapReady]); pattern
$closePattern = "}, [drivers, mapReady]);"
$firstCloseIdx = $mapJoined.IndexOf($closePattern)
if ($firstCloseIdx -ge 0) {
    $secondCloseIdx = $mapJoined.IndexOf($closePattern, $firstCloseIdx + $closePattern.Length)
    if ($secondCloseIdx -ge 0) {
        $duplicateClose = $true
    }
}
if ($corruptionFound -or $duplicateClose) {
    Write-Host "  FOUND corruption in standalone driver markers cleanup" -ForegroundColor Yellow
    # Strategy: find the line range from "nextStandalone[id] = marker;" to
    # the line BEFORE "// ===== AUTO-FOLLOW" or "// ===== AUTO FOLLOW"
    # and replace with correct cleanup code.
    $cleanupStart = -1
    $cleanupEnd   = -1
    for ($m = 0; $m -lt $mapLines.Length; $m++) {
        if ($cleanupStart -eq -1 -and $mapLines[$m].Trim() -eq "nextStandalone[id] = marker;") {
            $cleanupStart = $m + 1  # start replacing AFTER this line
        }
        if ($cleanupStart -ne -1 -and $cleanupEnd -eq -1) {
            if ($mapLines[$m] -match '// ===== AUTO.?FOLLOW') {
                $cleanupEnd = $m  # stop BEFORE this line
                break
            }
        }
    }
    if ($cleanupStart -eq -1) {
        # Fallback: search for the "for (const pair of" line
        for ($m = 0; $m -lt $mapLines.Length; $m++) {
            if ($mapLines[$m].Contains("for (const pair of Object.entries(standaloneDriverMarkersRef")) {
                $cleanupStart = $m
                break
            }
        }
        if ($cleanupStart -ne -1 -and $cleanupEnd -eq -1) {
            for ($m = $cleanupStart; $m -lt $mapLines.Length; $m++) {
                if ($mapLines[$m] -match '// ===== AUTO.?FOLLOW') {
                    $cleanupEnd = $m
                    break
                }
            }
        }
    }
    if ($cleanupStart -ne -1 -and $cleanupEnd -ne -1 -and $cleanupEnd -gt $cleanupStart) {
        $correctCleanup = @(
            "    }",
            "",
            "    // Remove markers for drivers no longer present",
            "    for (const [id, marker] of Object.entries(standaloneDriverMarkersRef.current)) {",
            "      if (!nextStandalone[id]) marker.remove();",
            "    }",
            "    standaloneDriverMarkersRef.current = nextStandalone;",
            "  }, [drivers, mapReady]);",
            ""
        )
        $beforeCleanup = $mapLines[0..($cleanupStart - 1)]
        $afterCleanup  = $mapLines[$cleanupEnd..($mapLines.Length - 1)]
        $mapLines = $beforeCleanup + $correctCleanup + $afterCleanup
        $removedMapLines = $cleanupEnd - $cleanupStart
        Write-Host "  REPLACED $removedMapLines corrupted lines with correct cleanup" -ForegroundColor Green
    } else {
        Write-Host "  WARN: could not locate cleanup boundaries (start=$cleanupStart end=$cleanupEnd)" -ForegroundColor Yellow
        Write-Host "  Manual review of standalone driver markers useEffect may be needed" -ForegroundColor Yellow
    }
} else {
    Write-Host "  OK: No PowerShell corruption or duplicate closings detected" -ForegroundColor Green
}
# ---- Write map file ----
$finalMapContent = $mapLines -join "`n"
[System.IO.File]::WriteAllText(
    $mapFile,
    $finalMapContent,
    (New-Object System.Text.UTF8Encoding $false)
)
Write-Host "  WROTE LiveTripsMap.tsx ($($mapLines.Length) lines, was $origMapCount)" -ForegroundColor Green
# ================================================================
# POST-PATCH VERIFICATION
# ================================================================
Write-Host ""
Write-Host "--- Verification ---" -ForegroundColor Cyan
$verifyClient = [System.IO.File]::ReadAllText($clientFile, [System.Text.Encoding]::UTF8)
$verifyMap    = [System.IO.File]::ReadAllText($mapFile, [System.Text.Encoding]::UTF8)
$allPass = $true
# V1: No stray "Eligible:" JSX outside return
$strayCheck = [regex]::Matches($verifyClient, 'Eligible: \{drivers\.filter')
if ($strayCheck.Count -gt 0) {
    Write-Host "  FAIL: $($strayCheck.Count) stray Eligible blocks still present in LiveTripsClient" -ForegroundColor Red
    $allPass = $false
} else {
    Write-Host "  PASS: No stray JSX blocks in LiveTripsClient" -ForegroundColor Green
}
# V2: drivers prop passed
if ($verifyClient.Contains("drivers={drivers")) {
    Write-Host "  PASS: drivers prop passed to LiveTripsMap" -ForegroundColor Green
} else {
    Write-Host "  FAIL: drivers prop NOT passed to LiveTripsMap" -ForegroundColor Red
    $allPass = $false
}
# V3: No PowerShell syntax in map
if ($verifyMap.Contains("-not nextStandalone")) {
    Write-Host "  FAIL: PowerShell syntax still in LiveTripsMap" -ForegroundColor Red
    $allPass = $false
} else {
    Write-Host "  PASS: No PowerShell syntax in LiveTripsMap" -ForegroundColor Green
}
# V4: standaloneDriverMarkersRef present
if ($verifyMap.Contains("standaloneDriverMarkersRef")) {
    Write-Host "  PASS: standaloneDriverMarkersRef present" -ForegroundColor Green
} else {
    Write-Host "  FAIL: standaloneDriverMarkersRef missing" -ForegroundColor Red
    $allPass = $false
}
# V5: DriverLocation type
if ($verifyMap.Contains("export type DriverLocation")) {
    Write-Host "  PASS: DriverLocation type present" -ForegroundColor Green
} else {
    Write-Host "  WARN: DriverLocation type missing" -ForegroundColor Yellow
}
# V6: standalone useEffect
if ($verifyMap.Contains("STANDALONE DRIVER")) {
    Write-Host "  PASS: Standalone driver markers useEffect present" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Standalone driver markers useEffect missing" -ForegroundColor Red
    $allPass = $false
}
# V7: No duplicate }, [drivers, mapReady]);
$mapCloseMatches = [regex]::Matches($verifyMap, '\},\s*\[drivers,\s*mapReady\]\);')
if ($mapCloseMatches.Count -gt 1) {
    Write-Host "  FAIL: $($mapCloseMatches.Count) duplicate driver useEffect closings found" -ForegroundColor Red
    $allPass = $false
} elseif ($mapCloseMatches.Count -eq 1) {
    Write-Host "  PASS: Exactly 1 driver useEffect closing" -ForegroundColor Green
} else {
    Write-Host "  WARN: No driver useEffect closing found" -ForegroundColor Yellow
}
# ================================================================
# SUMMARY
# ================================================================
Write-Host ""
if ($allPass) {
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  Script 4 COMPLETE — ALL CHECKS PASSED" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
} else {
    Write-Host "============================================" -ForegroundColor Yellow
    Write-Host "  Script 4 COMPLETE — SOME CHECKS FAILED" -ForegroundColor Yellow
    Write-Host "  Review warnings above. Manual fix may be needed." -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Files patched:" -ForegroundColor White
Write-Host "    app/admin/livetrips/LiveTripsClient.tsx" -ForegroundColor Cyan
Write-Host "    app/admin/livetrips/components/LiveTripsMap.tsx" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Driver markers: blue (#2563eb) = online | gray (#94a3b8) = stale" -ForegroundColor Cyan
Write-Host "  Hover tooltip:  name | status | town" -ForegroundColor Cyan
Write-Host ""
Write-Host "  NEXT STEPS:" -ForegroundColor Yellow
Write-Host "    npm run build" -ForegroundColor White
Write-Host "    git add -A" -ForegroundColor White
Write-Host '    git commit -m "fix: repair LiveTrips stray JSX + driver markers (script4)"' -ForegroundColor White
Write-Host "    git tag script4-map-driver-markers" -ForegroundColor White
Write-Host "    git push origin main --tags" -ForegroundColor White
$patchedMapLines = Replace-SectionByAnchors -Lines $patchedMapLines -StartAnchor '// ===== STANDALONE DRIVER MARKERS (independent from trip data) =====' -EndAnchor '// ===== AUTO-FOLLOW =====' -Replacement $standaloneDriverSection -Label 'standalone driver marker effect'
$patchedMapText = Join-Lines $patchedMapLines
Write-Step 'Verify patched content in memory'
if ([regex]::IsMatch($patchedClientText, 'Eligible:\s*\{drivers\.filter')) {
    Fail 'ABORT: LiveTripsClient.tsx still contains stray Eligible JSX after patching'
}
if ([regex]::IsMatch($patchedClientText, 'Stale:\s*\{drivers\.filter')) {
    Fail 'ABORT: LiveTripsClient.tsx still contains stray Stale JSX after patching'
}
if ([regex]::IsMatch($patchedClientText, 'Active Trips:\s*\{allTrips\.filter')) {
    Fail 'ABORT: LiveTripsClient.tsx still contains stray Active Trips JSX after patching'
}
if ([regex]::IsMatch($patchedClientText, 'Waiting Trips:\s*\{allTrips\.filter')) {
    Fail 'ABORT: LiveTripsClient.tsx still contains stray Waiting Trips JSX after patching'
}
if (-not [regex]::IsMatch($patchedClientText, '(?s)<LiveTripsMap\b.*?drivers\s*=\s*\{drivers(?:\s+as\s+any)?\}')) {
    Fail 'ABORT: LiveTripsClient.tsx does not pass drivers prop to LiveTripsMap after patching'
}
if (-not $patchedMapText.Contains('drivers?: DriverLocation[];')) {
    Fail 'ABORT: LiveTripsMap.tsx interface does not include drivers prop after patching'
}
if (-not $patchedMapText.Contains('drivers = [],')) {
    Fail 'ABORT: LiveTripsMap.tsx component parameters do not default drivers to [] after patching'
}
if ($patchedMapText.Contains('-not nextStandalone')) {
    Fail 'ABORT: LiveTripsMap.tsx still contains leaked PowerShell syntax after patching'
}
if (-not $patchedMapText.Contains('const standaloneDriverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});')) {
    Fail 'ABORT: LiveTripsMap.tsx lost standaloneDriverMarkersRef after patching'
}
if (-not $patchedMapText.Contains('for (const [id, marker] of Object.entries(standaloneDriverMarkersRef.current)) {')) {
    Fail 'ABORT: LiveTripsMap.tsx cleanup loop for standalone markers is missing after patching'
}
if (-not $patchedMapText.Contains('standaloneDriverMarkersRef.current = nextStandalone;')) {
    Fail 'ABORT: LiveTripsMap.tsx does not persist standalone marker state after patching'
}
Write-Ok 'In-memory verification passed'
Write-Step 'Write patched files to disk'
Write-Utf8NoBom -Path $clientFile -Content $patchedClientText
Write-Utf8NoBom -Path $mapFile -Content $patchedMapText
Write-Ok 'Patched files written as UTF-8 without BOM'
Write-Step 'Re-read files and verify on disk'
$verifyClientText = Join-Lines (Read-Utf8Lines $clientFile)
$verifyMapText = Join-Lines (Read-Utf8Lines $mapFile)
if ([regex]::IsMatch($verifyClientText, 'Eligible:\s*\{drivers\.filter')) {
    Fail 'ABORT: on-disk LiveTripsClient.tsx still contains stray Eligible JSX'
}
if (-not [regex]::IsMatch($verifyClientText, '(?s)<LiveTripsMap\b.*?drivers\s*=\s*\{drivers(?:\s+as\s+any)?\}')) {
    Fail 'ABORT: on-disk LiveTripsClient.tsx is missing drivers prop on LiveTripsMap'
}
if ($verifyMapText.Contains('-not nextStandalone')) {
    Fail 'ABORT: on-disk LiveTripsMap.tsx still contains leaked PowerShell syntax'
}
if (-not $verifyMapText.Contains('drivers?: DriverLocation[];')) {
    Fail 'ABORT: on-disk LiveTripsMap.tsx is missing drivers prop in interface'
}
if (-not $verifyMapText.Contains('drivers = [],')) {
    Fail 'ABORT: on-disk LiveTripsMap.tsx is missing drivers default in component parameters'
}
if (-not $verifyMapText.Contains('standaloneDriverMarkersRef.current = nextStandalone;')) {
    Fail 'ABORT: on-disk LiveTripsMap.tsx is missing standalone marker state assignment'
}
Assert-AsciiText -Text $verifyClientText -Label 'On-disk LiveTripsClient.tsx'
Write-Ok 'On-disk verification passed'
Write-Step 'Summary'
$clientHash = (Get-FileHash -Algorithm SHA256 -Path $clientFile).Hash
$mapHash = (Get-FileHash -Algorithm SHA256 -Path $mapFile).Hash
Write-Host ''
Write-Host 'PATCH COMPLETE' -ForegroundColor Green
Write-Host ('  LiveTripsClient.tsx stray blocks removed: ' + $removedBlocks) -ForegroundColor White
Write-Host ('  LiveTripsClient.tsx SHA256: ' + $clientHash) -ForegroundColor White
Write-Host ('  LiveTripsMap.tsx SHA256:    ' + $mapHash) -ForegroundColor White
Write-Host ('  Backups directory:          ' + $backupDir) -ForegroundColor White
Write-Host ''
Write-Host 'NEXT:' -ForegroundColor Yellow
Write-Host '  npm run build' -ForegroundColor White
Write-Host '  git add -A' -ForegroundColor White
Write-Host '  git commit -m "fix: repair LiveTrips stray JSX + driver markers (script4)"' -ForegroundColor White
Write-Host '  git tag script4-map-driver-markers' -ForegroundColor White
Write-Host '  git push origin main --tags' -ForegroundColor White