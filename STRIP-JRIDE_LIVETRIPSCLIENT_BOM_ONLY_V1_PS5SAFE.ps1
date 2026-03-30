param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 100)
    Write-Host $Text
    Write-Host ("=" * 100)
}

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "File not found: $FilePath"
}

$full = [System.IO.Path]::GetFullPath($FilePath)
$root = Split-Path -Parent $full
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outRoot = Join-Path $root "_ascii_fix\$timestamp"
$backupPath = Join-Path $outRoot "LiveTripsClient.tsx.bak"
$reportPath = Join-Path $outRoot "ASCII_FIX_REPORT.txt"

Ensure-Dir $outRoot

Write-Section "JRIDE LIVETRIPSCLIENT BOM-ONLY FIX"
Write-Host "File   : $full"
Write-Host "Backup : $backupPath"

$bytes = [System.IO.File]::ReadAllBytes($full)
[System.IO.File]::WriteAllBytes($backupPath, $bytes)

$hadBom = $false
if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    $hadBom = $true
}

if (-not $hadBom) {
    Write-Host "[OK] No BOM found. File left unchanged."
    @"
JRIDE LIVETRIPSCLIENT BOM-ONLY FIX
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
File: $full
Result: NO_BOM_FOUND
Action: NONE
Backup: $backupPath
"@ | Set-Content -LiteralPath $reportPath -Encoding UTF8
    exit 0
}

$text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($full, $text, $utf8NoBom)

$after = [System.IO.File]::ReadAllBytes($full)
$stillHasBom = $false
if ($after.Length -ge 3 -and $after[0] -eq 239 -and $after[1] -eq 187 -and $after[2] -eq 191) {
    $stillHasBom = $true
}

if ($stillHasBom) {
    throw "BOM removal failed: BOM still present after write."
}

$nonAsciiCount = 0
for ($i = 0; $i -lt $after.Length; $i++) {
    if ($after[$i] -gt 127) {
        $nonAsciiCount++
    }
}

Write-Host "[OK] BOM removed."
Write-Host "[OK] Remaining bytes > 127: $nonAsciiCount"

@"
JRIDE LIVETRIPSCLIENT BOM-ONLY FIX
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
File: $full
Result: BOM_REMOVED
RemainingBytesGT127: $nonAsciiCount
Backup: $backupPath
"@ | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Section "DONE"
Write-Host "Report : $reportPath"
Write-Host "Backup : $backupPath"