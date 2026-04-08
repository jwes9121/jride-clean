param(
    [Parameter(Mandatory = $true)]
    [string]$WebRoot,

    [string]$DiscoveryReportPath = "",

    [switch]$IncludeWalletLifecycleUI
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

function Resolve-FullPath {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Copy-RelativeFile {
    param(
        [string]$BaseRoot,
        [string]$RelativePath,
        [string]$DestRoot
    )

    $src = Join-Path $BaseRoot $RelativePath
    if (-not (Test-Path -LiteralPath $src)) {
        return $false
    }

    $dest = Join-Path $DestRoot $RelativePath
    $destDir = Split-Path -Parent $dest
    Ensure-Dir $destDir
    Copy-Item -LiteralPath $src -Destination $dest -Force
    return $true
}

function Add-ManifestRow {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Category,
        [string]$RelativePath,
        [string]$Status
    )

    $Rows.Add([PSCustomObject]@{
        Category     = $Category
        RelativePath = $RelativePath
        Status       = $Status
    }) | Out-Null
}

$root = Resolve-FullPath -Path $WebRoot
if (-not (Test-Path -LiteralPath $root)) {
    throw "WebRoot not found: $root"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outRoot = Join-Path $root "_jride_upload_package\$timestamp"
$bundleRoot = Join-Path $outRoot "upload_bundle"
$manifestPath = Join-Path $outRoot "UPLOAD_MANIFEST.txt"
$csvPath = Join-Path $outRoot "UPLOAD_MANIFEST.csv"
$zipPath = Join-Path $outRoot "JRIDE_AUTHORITATIVE_UPLOAD_SET.zip"

Ensure-Dir $outRoot
Ensure-Dir $bundleRoot

$manifestLines = New-Object "System.Collections.Generic.List[string]"
$manifestRows = New-Object "System.Collections.Generic.List[object]"

$canonical = @(
    "app\api\dispatch\assign\route.ts",
    "app\api\dispatch\status\route.ts",
    "app\api\driver\fare\propose\route.ts",
    "app\api\rides\fare-response\route.ts",
    "app\api\passenger\track\route.ts",
    "app\api\public\passenger\booking\route.ts",
    "app\api\admin\livetrips\page-data\route.ts",
    "app\admin\livetrips\LiveTripsClient.tsx",
    "app\admin\livetrips\components\LiveTripsMap.tsx",
    "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
)

$optionalWalletLifecycle = @(
    "app\admin\livetrips\components\TripWalletPanel.tsx",
    "app\admin\livetrips\components\TripLifecycleActions.tsx"
)

Write-Section "JRIDE AUTHORITATIVE UPLOAD PACKAGER"
Write-Host "WebRoot : $root"
Write-Host "Output  : $outRoot"

$manifestLines.Add("JRIDE AUTHORITATIVE UPLOAD PACKAGER") | Out-Null
$manifestLines.Add(("Generated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))) | Out-Null
$manifestLines.Add(("WebRoot: " + $root)) | Out-Null
$manifestLines.Add("") | Out-Null

if ($DiscoveryReportPath -and (Test-Path -LiteralPath $DiscoveryReportPath)) {
    $resolvedReport = Resolve-FullPath -Path $DiscoveryReportPath
    Write-Host "Discovery report provided: $resolvedReport"
    $manifestLines.Add(("Discovery report: " + $resolvedReport)) | Out-Null
    $manifestLines.Add("") | Out-Null
}

Write-Section "COPY CANONICAL FILES"
$manifestLines.Add("CANONICAL FILES") | Out-Null
$manifestLines.Add("---------------") | Out-Null

foreach ($rel in $canonical) {
    $copied = Copy-RelativeFile -BaseRoot $root -RelativePath $rel -DestRoot $bundleRoot
    if ($copied) {
        Write-Host ("[COPIED] " + $rel)
        $manifestLines.Add("[COPIED] $rel") | Out-Null
        Add-ManifestRow -Rows $manifestRows -Category "canonical" -RelativePath $rel -Status "COPIED"
    } else {
        Write-Host ("[MISSING] " + $rel)
        $manifestLines.Add("[MISSING] $rel") | Out-Null
        Add-ManifestRow -Rows $manifestRows -Category "canonical" -RelativePath $rel -Status "MISSING"
    }
}

$manifestLines.Add("") | Out-Null

Write-Section "COPY OPTIONAL WALLET/LIFECYCLE UI"
$manifestLines.Add("OPTIONAL WALLET/LIFECYCLE UI") | Out-Null
$manifestLines.Add("----------------------------") | Out-Null

foreach ($rel in $optionalWalletLifecycle) {
    if ($IncludeWalletLifecycleUI) {
        $copied = Copy-RelativeFile -BaseRoot $root -RelativePath $rel -DestRoot $bundleRoot
        if ($copied) {
            Write-Host ("[COPIED] " + $rel)
            $manifestLines.Add("[COPIED] $rel") | Out-Null
            Add-ManifestRow -Rows $manifestRows -Category "optional_wallet_lifecycle_ui" -RelativePath $rel -Status "COPIED"
        } else {
            Write-Host ("[MISSING] " + $rel)
            $manifestLines.Add("[MISSING] $rel") | Out-Null
            Add-ManifestRow -Rows $manifestRows -Category "optional_wallet_lifecycle_ui" -RelativePath $rel -Status "MISSING"
        }
    } else {
        Write-Host ("[SKIPPED] " + $rel)
        $manifestLines.Add("[SKIPPED] $rel") | Out-Null
        Add-ManifestRow -Rows $manifestRows -Category "optional_wallet_lifecycle_ui" -RelativePath $rel -Status "SKIPPED"
    }
}

$manifestLines.Add("") | Out-Null

Write-Section "VERIFY NO BACKUP FILES INCLUDED"
$manifestLines.Add("BACKUP/RESTORE SANITY CHECK") | Out-Null
$manifestLines.Add("---------------------------") | Out-Null

$badFiles = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File | Where-Object {
    $_.Name -match '\.bak(\.|$)' -or
    $_.FullName -match '\\_patch_bak\\' -or
    $_.Name -match '\.restore\.' -or
    $_.Name -match '\.pre_restore' -or
    $_.Name -match '\.pre_autorestore' -or
    $_.Name -match '\.repairbak\.' -or
    $_.Name -match '\.before_restore' -or
    $_.Name -match '\.FINAL_SAFE_BACKUP\.' -or
    $_.Name -match '\.MANUAL_RESTORE_BACKUP\.'
}

if ($badFiles.Count -gt 0) {
    foreach ($f in $badFiles) {
        Write-Host ("[REMOVE] " + $f.FullName.Substring($bundleRoot.Length).TrimStart('\','/'))
        Remove-Item -LiteralPath $f.FullName -Force
    }
    $manifestLines.Add("Removed backup/restore files from bundle.") | Out-Null
} else {
    Write-Host "[OK] No backup/restore files found in bundle."
    $manifestLines.Add("[OK] No backup/restore files found in bundle.") | Out-Null
}

$manifestLines.Add("") | Out-Null

Write-Section "WRITE MANIFEST"
$manifestLines | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$manifestRows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

Write-Host "Manifest TXT : $manifestPath"
Write-Host "Manifest CSV : $csvPath"

Write-Section "CREATE ZIP"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $bundleRoot "*") -DestinationPath $zipPath -Force

Write-Host "ZIP created  : $zipPath"

Write-Section "DONE"
Write-Host "Package complete."
Write-Host "Upload the contents of upload_bundle or the ZIP file."
Write-Host "This package contains only the authoritative target files."
Write-Host "No source files were modified."