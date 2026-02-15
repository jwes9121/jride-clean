param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [string]$Tag = "JRIDE_RIDE_ACTIVEBOOKING_HELPERS_V1"
)

$ErrorActionPreference="Stop"
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Restore: app/ride/page.tsx from tag (V1 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host ("Repo: {0}" -f $ProjRoot) -ForegroundColor Gray

if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found." }
Set-Location -LiteralPath $ProjRoot

# Ensure git repo
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Fail "[FAIL] Not a git repo." }

# Ensure tag exists (local). If not, fetch tags.
git rev-parse -q --verify "refs/tags/$Tag" *> $null
if ($LASTEXITCODE -ne 0) {
  Warn "[WARN] Tag not found locally. Fetching tags..."
  git fetch --tags
  git rev-parse -q --verify "refs/tags/$Tag" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "[FAIL] Tag still not found: $Tag" }
}

$F = Join-Path $ProjRoot "app\ride\page.tsx"
if (-not (Test-Path -LiteralPath $F)) { Fail "[FAIL] Missing file: app/ride/page.tsx" }

# Backup current file
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("ride.page.tsx.bak.RESTORE_{0}.{1}" -f $Tag, $stamp)
Copy-Item -Force -LiteralPath $F -Destination $bak
Ok ("[OK] Backup: {0}" -f $bak)

# Restore file from tag
git checkout $Tag -- app/ride/page.tsx
if ($LASTEXITCODE -ne 0) { Fail "[FAIL] git checkout from tag failed." }

$len = (Get-Item -LiteralPath $F).Length
Ok ("[OK] Restored app/ride/page.tsx bytes: {0}" -f $len)

# Safety: block if still huge (GitHub limit protection)
if ($len -gt 90000000) { Fail "[FAIL] ride/page.tsx still too large (>90MB). STOP." }

# Commit + push
git add app/ride/page.tsx
git commit -m ("Emergency restore: app/ride/page.tsx from tag {0}" -f $Tag)
if ($LASTEXITCODE -ne 0) {
  Warn "[WARN] Nothing to commit (file may already match)."
}

git push
Ok "[OK] Pushed. Vercel should redeploy from main."
Write-Host "NEXT: Hard refresh /ride after deploy, ideally in Incognito (extensions OFF)." -ForegroundColor Cyan
