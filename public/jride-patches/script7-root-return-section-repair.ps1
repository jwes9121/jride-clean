# ============================================================
# SCRIPT 7 - ROOT RETURN SECTION REPAIR
# ============================================================
# Repairs app/admin/livetrips/LiveTripsClient.tsx by replacing
# the component header section from:
#   const showThresholds =
# through the line before:
#   <div className="mt-3 flex flex-wrap gap-2">
#
# Source of truth:
#   public/jride-patches/LiveTripsClient-UPLOADED.tsx
#
# This fixes hidden structural corruption that can still produce:
#   Unexpected token `div`. Expected jsx identifier
# even after callback/summary cleanup scripts pass.
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
function Get-LineIndexContaining([string[]]$Lines, [string]$Needle, [int]$StartAt = 0) {
    for ($idx = $StartAt; $idx -lt $Lines.Length; $idx++) {
        if ($Lines[$idx].Contains($Needle)) {
            return $idx
        }
    }
    return -1
}
function Count-Regex([string]$Text, [string]$Pattern) {
    return ([regex]::Matches($Text, $Pattern)).Count
}
# ---- LOCATE TARGET + REFERENCE ----
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
$reference = Join-Path $repoRoot "public\jride-patches\LiveTripsClient-UPLOADED.tsx"
if (-not (Test-Path -LiteralPath $target)) {
    Fail ("Target not found: " + $target)
}
if (-not (Test-Path -LiteralPath $reference)) {
    Fail ("Reference not found: " + $reference)
}
Write-Host "TARGET: $target" -ForegroundColor Cyan
Write-Host "REFERENCE: $reference" -ForegroundColor Cyan
# ---- BACKUP ----
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $repoRoot ("_backups\script7-root-return-section-repair-" + $timestamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir "LiveTripsClient.tsx.bak") -Force
Write-Host "BACKUP: $backupDir" -ForegroundColor Green
# ---- READ ----
$targetLines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$refLines = [System.IO.File]::ReadAllLines($reference, [System.Text.Encoding]::UTF8)
Write-Host "READ TARGET: $($targetLines.Length) lines" -ForegroundColor Cyan
Write-Host "READ REFERENCE: $($refLines.Length) lines" -ForegroundColor Cyan
# ---- FINGERPRINT ----
$startAnchor = 'const showThresholds ='
$endAnchor = '<div className="mt-3 flex flex-wrap gap-2">'
$headingAnchor = '<h1 className="text-xl font-semibold">Live Trips</h1>'
$refStart = Get-LineIndexContaining $refLines $startAnchor 0
$refEnd = Get-LineIndexContaining $refLines $endAnchor 0
$refHeading = Get-LineIndexContaining $refLines $headingAnchor 0
if ($refStart -lt 0) {
    Fail "Reference fingerprint failed: const showThresholds anchor not found"
}
if ($refEnd -lt 0) {
    Fail "Reference fingerprint failed: tab-row anchor not found"
}
if ($refHeading -lt 0) {
    Fail "Reference fingerprint failed: Live Trips heading anchor not found"
}
if ($refEnd -le $refStart) {
    Fail "Reference fingerprint failed: invalid section order"
}
$refSectionText = [string]::Join("`n", $refLines[$refStart..($refEnd - 1)])
if ($refSectionText -match 'SUPPLY SUMMARY') {
    Fail "Reference fingerprint failed: uploaded reference section is contaminated"
}
$targetStart = Get-LineIndexContaining $targetLines $startAnchor 0
$targetEnd = Get-LineIndexContaining $targetLines $endAnchor 0
if ($targetStart -lt 0) {
    Fail "Target anchor not found: const showThresholds ="
}
if ($targetEnd -lt 0) {
    Fail "Target anchor not found: <div className=\"mt-3 flex flex-wrap gap-2\">"
}
if ($targetEnd -le $targetStart) {
    Fail "Target section order invalid: tab-row anchor occurs before showThresholds"
}
# ---- REPLACE SECTION ----
$replacement = @($refLines[$refStart..($refEnd - 1)])
$out = New-Object 'System.Collections.Generic.List[string]'
for ($i = 0; $i -lt $targetStart; $i++) {
    $out.Add($targetLines[$i])
}
foreach ($line in $replacement) {
    $out.Add($line)
}
for ($i = $targetEnd; $i -lt $targetLines.Length; $i++) {
    $out.Add($targetLines[$i])
}
$outLines = @($out.ToArray())
Write-Utf8NoBom $target $outLines
# ---- VERIFY ----
Write-Host "`n== VERIFICATION ==" -ForegroundColor Cyan
$verifyLines = [System.IO.File]::ReadAllLines($target, [System.Text.Encoding]::UTF8)
$verifyText = [string]::Join("`n", $verifyLines)
$verifyStart = Get-LineIndexContaining $verifyLines $startAnchor 0
$verifyEnd = Get-LineIndexContaining $verifyLines $endAnchor 0
if ($verifyStart -lt 0 -or $verifyEnd -lt 0 -or $verifyEnd -le $verifyStart) {
    Fail "VERIFY FAILED: repaired section anchors missing or misordered"
}
$verifySection = @($verifyLines[$verifyStart..($verifyEnd - 1)])
$verifySectionText = [string]::Join("`n", $verifySection)
if ($verifySection.Count -ne $replacement.Count) {
    Fail ("VERIFY FAILED: section line count mismatch target=" + $verifySection.Count + " reference=" + $replacement.Count)
}
for ($i = 0; $i -lt $replacement.Count; $i++) {
    if ($verifySection[$i] -cne $replacement[$i]) {
        Fail ("VERIFY FAILED: repaired section differs from reference at relative line " + ($i + 1))
    }
}
Write-Host "  PASS: root return section matches uploaded reference" -ForegroundColor Green
$returnLine = Get-LineIndexContaining $verifyLines '  return (' $verifyStart
if ($returnLine -lt 0 -or $returnLine -gt ($verifyStart + 20)) {
    Fail "VERIFY FAILED: component return not found in repaired section"
}
Write-Host "  PASS: component return located inside repaired section" -ForegroundColor Green
$rootDivLine = Get-LineIndexContaining $verifyLines '    <div className="p-4">' $returnLine
if ($rootDivLine -ne ($returnLine + 1)) {
    Fail "VERIFY FAILED: root <div className=\"p-4\"> not immediately after return ("
}
Write-Host "  PASS: root JSX opens correctly after return (" -ForegroundColor Green
if ($verifySectionText -match 'SUPPLY SUMMARY') {
    Fail "VERIFY FAILED: stray SUPPLY SUMMARY marker still present in repaired section"
}
if ($verifySectionText -match 'Eligible:\s*\{drivers\.filter') {
    Fail "VERIFY FAILED: stray Eligible summary JSX still present in repaired section"
}
if ($verifySectionText -match 'Stale:\s*\{drivers\.filter') {
    Fail "VERIFY FAILED: stray Stale summary JSX still present in repaired section"
}
Write-Host "  PASS: no stray summary JSX remains in repaired section" -ForegroundColor Green
$beforeText = [string]::Join("`n", $verifyLines[0..($returnLine-1)])
$openCount = Count-Regex $beforeText '\{'
$closeCount = Count-Regex $beforeText '\}'
$diff = $openCount - $closeCount
Write-Host ("  INFO: raw brace balance before return = " + $diff) -ForegroundColor Yellow
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
Write-Host ('  Replaced lines: ' + ($targetStart + 1) + ' .. ' + $targetEnd) -ForegroundColor White
Write-Host ('  Reference lines: ' + ($refStart + 1) + ' .. ' + $refEnd) -ForegroundColor White
Write-Host ('  Target lines: ' + $targetLines.Length + ' -> ' + $outLines.Length) -ForegroundColor White
Write-Host ('  SHA256: ' + $hash) -ForegroundColor White
Write-Host ('  Backup: ' + $backupDir) -ForegroundColor White
Write-Host ''
Write-Host 'RUN:' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script7-root-return-section-repair.ps1' -ForegroundColor White
Write-Host 'BUILD:' -ForegroundColor Yellow
Write-Host '  npm run build' -ForegroundColor White