param(
    [Parameter(Mandatory=$true)]
    [string]$ProjRoot,

    [string]$OutDir = "$ProjRoot\_review_export"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

if (!(Test-Path $ProjRoot)) {
    Fail "Project root not found: $ProjRoot"
}

if (!(Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$zipPath = Join-Path $OutDir "JRIDE_WEB_REVIEW_$stamp.zip"

$tempDir = Join-Path $OutDir "_tmp_$stamp"
New-Item -ItemType Directory -Path $tempDir | Out-Null

Ok "Collecting project files..."

$includePaths = @(
    "app",
    "components",
    "utils",
    "lib",
    "middleware.ts",
    "next.config.js",
    "package.json",
    "tsconfig.json",
    "supabase"
)

foreach ($item in $includePaths) {
    $src = Join-Path $ProjRoot $item
    if (Test-Path $src) {
        Copy-Item $src -Destination $tempDir -Recurse -Force
        Ok "Included: $item"
    }
    else {
        Warn "Skipped (not found): $item"
    }
}

# Remove heavy/unnecessary folders if copied
$exclude = @(
    "node_modules",
    ".next",
    ".git"
)

foreach ($ex in $exclude) {
    $path = Join-Path $tempDir $ex
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        Warn "Excluded: $ex"
    }
}

Ok "Compressing..."

Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

Remove-Item $tempDir -Recurse -Force

Ok "Export complete:"
Ok $zipPath
