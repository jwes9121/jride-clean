param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Backup-File([string]$Path, [string]$Tag) {
  if (!(Test-Path $Path)) { return }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $Tag, $ts)
  Copy-Item -Force $Path $bak
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host "== PATCH JRIDE dispatch/status actor reference fix (V1 / PS5-safe) =="
Write-Host "Repo: $ProjRoot"

$path = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path $path)) { throw "Missing: $path" }

Backup-File $path "DISPATCH_STATUS_ACTOR_FIX_V1"

$src = Get-Content -Raw -LiteralPath $path

# Replace ONLY inside our injected V6C block.
# Old:
# const actorForLog = (typeof actor !== "undefined" ... ) ? ... : ...
# New: actorUserId if available else system
$oldPattern = '(?s)//\s*JRIDE_DISPATCH_ACTIONS_LOG_V6C.*?const\s+actorForLog\s*=\s*.*?;\s*'
if ($src -notmatch $oldPattern) {
  throw "Could not find JRIDE_DISPATCH_ACTIONS_LOG_V6C block to patch."
}

$replacement = @'
// JRIDE_DISPATCH_ACTIONS_LOG_V6C (non-blocking)
  try {
    const actorForLog =
      ((typeof actorUserId !== "undefined" && actorUserId) ? String(actorUserId) : "system");
'@

$src2 = [regex]::Replace($src, $oldPattern, $replacement, 1)

Write-Utf8NoBom -Path $path -Content $src2
Write-Host "[OK] Patched: $path"

Write-Host ""
Write-Host "[NEXT] Build again:"
Write-Host "  npm.cmd run build"
