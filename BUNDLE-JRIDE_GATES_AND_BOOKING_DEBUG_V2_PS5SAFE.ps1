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

function CopyIfExists([string]$rel, [string]$destRoot, [ref]$manifest){
  $src = Join-Path $RepoRoot $rel
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $destRoot $rel
    EnsureDir (Split-Path -Parent $dst)
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $manifest.Value += "OK   $rel`r`n"
    Ok  ("[OK]   {0}" -f $rel)
  } else {
    $manifest.Value += "MISS $rel`r`n"
    Warn("[MISS] $rel")
  }
}

# Validate repo root
$pkg = Join-Path $RepoRoot "package.json"
if (!(Test-Path -LiteralPath $pkg)) { Fail "[FAIL] package.json not found. Run from repo root." }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outRoot = Join-Path $RepoRoot ("_support_bundle\GATES_BOOKING_DEBUG_{0}" -f $ts)
EnsureDir $outRoot

$zipPath = Join-Path $RepoRoot ("GATES_BOOKING_DEBUG_{0}.zip" -f $ts)

$manifest = ""
$manifest += "JRIDE Gates/Booking Debug Bundle`r`n"
$manifest += "Timestamp: $ts`r`n"
$manifest += "RepoRoot: $RepoRoot`r`n"
$manifest += "`r`nFILES:`r`n"

# ---- What we collect ----
# Passenger + Ride UI
$files = @(
  "app\ride\page.tsx",
  "app\passenger\page.tsx",

  # Gatekeeper APIs
  "app\api\public\passenger\can-book\route.ts",
  "app\api\public\passenger\book\route.ts",
  "app\api\public\passenger\free-ride\route.ts",
  "app\api\public\passenger\me\route.ts",

  # Passenger auth endpoints (phone/password system)
  "app\api\public\auth\session\route.ts",
  "app\api\public\auth\login\route.ts",
  "app\api\public\auth\logout\route.ts",

  # Any public passenger session variant (sometimes people use /api/public/passenger/session)
  "app\api\public\passenger\session\route.ts",

  # Middleware (may affect redirects/loops)
  "middleware.ts",

  # NextAuth/admin auth (just in case something overlaps)
  "auth.ts",
  "app\api\auth\[...nextauth]\route.ts",

  # Shared utilities where createClient/session helpers may live
  "lib\supabase\server.ts",
  "lib\supabase\client.ts",
  "lib\supabase\middleware.ts",
  "utils\supabase\server.ts",
  "utils\supabase\client.ts",
  "utils\supabase\middleware.ts",
  "app\lib\supabase\server.ts",
  "app\lib\supabase\client.ts",
  "app\lib\supabase\middleware.ts",

  # Config
  "next.config.js",
  "next.config.mjs",
  "package.json",
  "tsconfig.json"
)

foreach ($fel in $files) { CopyIfExists $Fel $outRoot ([ref]$manifest) }

# Also include any route handlers under api/public/passenger that may contain gate logic
# (We do a targeted copy: only route.ts files, no node_modules/.next/_patch_bak)
$manifest += "`r`nAUTO-COLLECTED ROUTES:`r`n"
$apiRoot = Join-Path $RepoRoot "app\api\public\passenger"
if (Test-Path -LiteralPath $apiRoot) {
  $routes = Get-ChildItem -LiteralPath $apiRoot -Recurse -File -Filter "route.ts" |
    Where-Object { $_.FullName -notmatch "\\_patch_bak\\" -and $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\.next\\" }
  foreach ($r in $routes) {
    $rel = $r.FullName.Substring($RepoRoot.Length + 1)
    CopyIfExists $rel $outRoot ([ref]$manifest)
  }
} else {
  $manifest += "MISS app\\api\\public\\passenger (folder not found)`r`n"
  Warn "[MISS] app\api\public\passenger (folder not found)"
}

# Also include any route handlers under api/public/auth
$manifest += "`r`nAUTO-COLLECTED AUTH ROUTES:`r`n"
$authRoot = Join-Path $RepoRoot "app\api\public\auth"
if (Test-Path -LiteralPath $authRoot) {
  $routes2 = Get-ChildItem -LiteralPath $authRoot -Recurse -File -Filter "route.ts" |
    Where-Object { $_.FullName -notmatch "\\_patch_bak\\" -and $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\.next\\" }
  foreach ($r in $routes2) {
    $rel = $r.FullName.Substring($RepoRoot.Length + 1)
    CopyIfExists $rel $outRoot ([ref]$manifest)
  }
} else {
  $manifest += "MISS app\\api\\public\\auth (folder not found)`r`n"
  Warn "[MISS] app\api\public\auth (folder not found)"
}

# NOTE: explicitly DO NOT include env files
$manifest += "`r`nNOTE: .env* files are intentionally NOT included.`r`n"

# Write manifest + tree
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$manifestPath = Join-Path $outRoot "MANIFEST.txt"
[System.IO.File]::WriteAllText($manifestPath, $manifest, $utf8NoBom)
Ok "[OK] Wrote MANIFEST.txt"

$treePath = Join-Path $outRoot "TREE.txt"
$tree = (Get-ChildItem -LiteralPath $outRoot -Recurse -File | ForEach-Object {
  $_.FullName.Substring($outRoot.Length + 1)
}) -join "`r`n"
[System.IO.File]::WriteAllText($treePath, $tree, $utf8NoBom)
Ok "[OK] Wrote TREE.txt"

# Zip it
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $outRoot "*") -DestinationPath $zipPath -Force

Ok ("[DONE] ZIP created: {0}" -f $zipPath)
Ok ("[DONE] Bundle folder: {0}" -f $outRoot)
