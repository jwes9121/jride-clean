param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$target = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing app\passenger\page.tsx" }

$src = Get-Content -LiteralPath $target -Raw

if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN") {
  Fail "[FAIL] Could not find JRIDE_SIGNOUT_BUTTON_BEGIN marker. Refusing to patch unknown signout code."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

# Replace the onClick inside our marker block only
$blockPattern = "(?s)(/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/.*?/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/)"
$block = [regex]::Match($src, $blockPattern).Groups[1].Value
if (-not $block) { Fail "[FAIL] Could not extract signout marker block." }

# Update callbackUrl from "/" to "/auth/signin" OR add a hard redirect if needed
$block2 = $block `
  -replace "signOut\(\{\s*callbackUrl:\s*`"/`"\s*\}\)", "signOut({ callbackUrl: `"/auth/signin`" })" `
  -replace "signOut\(\{\s*callbackUrl:\s*`"/auth/signin`"\s*\}\)", "signOut({ callbackUrl: `"/auth/signin`" })"

# If still not changed, fallback: replace onClick handler to hard redirect (still within marker)
if ($block2 -eq $block) {
  $block2 = [regex]::Replace(
    $block,
    "onClick=\{\(\)\s*=>\s*signOut\([^\)]*\)\s*\}",
    "onClick={async () => { await signOut({ redirect: false }); window.location.href = `"/auth/signin`"; }}",
    1
  )
}

if ($block2 -eq $block) { Fail "[FAIL] Could not update signOut handler within marker block." }

$src2 = $src.Replace($block, $block2)

WriteUtf8NoBom $target $src2
Ok "[OK] Updated Sign out redirect to /auth/signin (marker-safe)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_SIGNOUT_REDIRECT_V1_PS5SAFE"
