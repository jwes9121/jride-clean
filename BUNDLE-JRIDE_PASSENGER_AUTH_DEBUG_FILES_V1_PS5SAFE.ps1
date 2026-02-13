param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function CopyIfExists([string]$src, [string]$destRoot, [ref]$manifest){
  $full = Join-Path $RepoRoot $src
  if (Test-Path -LiteralPath $full) {
    $destPath = Join-Path $destRoot $src
    $destDir  = Split-Path -Parent $destPath
    EnsureDir $destDir
    Copy-Item -LiteralPath $full -Destination $destPath -Force
    $manifest.Value += "OK  $src`r`n"
    Ok  ("[OK]  {0}" -f $src)
  } else {
    $manifest.Value += "MISS $src`r`n"
    Warn("[MISS] $src")
  }
}

# --- Validate repo root ---
$pkg = Join-Path $RepoRoot "package.json"
if (!(Test-Path -LiteralPath $pkg)) {
  Fail "[FAIL] package.json not found. Run this script from your Next.js repo root."
}

# --- Bundle paths ---
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outRoot = Join-Path $RepoRoot ("_support_bundle\PASSENGER_AUTH_DEBUG_{0}" -f $ts)
EnsureDir $outRoot

$zipPath = Join-Path $RepoRoot ("PASSENGER_AUTH_DEBUG_{0}.zip" -f $ts)

$manifest = "JRIDE Passenger/Auth Debug Bundle`r`nTimestamp: $ts`r`nRepoRoot: $RepoRoot`r`n`r`nFILES:`r`n"

# --- Core files to collect (focused, no secrets) ---
$files = @(
  # Passenger UI / Ride UI
  "app\passenger\page.tsx",
  "app\ride\page.tsx",

  # Passenger APIs
  "app\api\public\passenger\can-book\route.ts",
  "app\api\public\passenger\free-ride\route.ts",
  "app\api\public\passenger\book\route.ts",
  "app\api\public\passenger\me\route.ts",

  # Auth (NextAuth v5)
  "auth.ts",
  "app\api\auth\[...nextauth]\route.ts",

  # Middleware (redirect loops / protection)
  "middleware.ts",

  # Common UI / headers that may include auth links
  "app\components\Header.tsx",

  # Config (build/runtime behavior)
  "next.config.js",
  "next.config.mjs",
  "package.json"
)

# Copy files if they exist
foreach ($f in $files) { CopyIfExists $f $outRoot ([ref]$manifest) }

# --- Also include any *.env* file? NO. We explicitly do NOT include env files. ---
$manifest += "`r`nNOTE: .env* files are intentionally NOT included.`r`n"

# Write manifest
$manifestPath = Join-Path $outRoot "MANIFEST.txt"
[System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))
Ok ("[OK] Wrote MANIFEST.txt")

# Tree listing for quick browsing
$treePath = Join-Path $outRoot "TREE.txt"
$tree = (Get-ChildItem -LiteralPath $outRoot -Recurse -File | ForEach-Object {
  $_.FullName.Substring($outRoot.Length + 1)
}) -join "`r`n"
[System.IO.File]::WriteAllText($treePath, $tree, (New-Object System.Text.UTF8Encoding($false)))
Ok ("[OK] Wrote TREE.txt")

# --- Zip it ---
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $outRoot "*") -DestinationPath $zipPath -Force

Ok ("[DONE] ZIP created: {0}" -f $zipPath)
Ok ("[DONE] Bundle folder: {0}" -f $outRoot)
