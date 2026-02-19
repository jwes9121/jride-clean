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

Write-Host "== PATCH JRIDE remove API dispatch_actions logging (V1 / PS5-safe) =="
Write-Host "Repo: $ProjRoot"

$path = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path $path)) { throw "Missing: $path" }

Backup-File $path "REMOVE_API_DISPATCH_LOGGING_V1"

$src = Get-Content -Raw -LiteralPath $path
$orig = $src

# Remove the injected API logging blocks (keep DB trigger logging as the single source of truth)
# 1) Primary marker used in prior patches
$src = [regex]::Replace(
  $src,
  '(?s)\r?\n\s*//\s*JRIDE_DISPATCH_ACTIONS_LOG_[A-Z0-9_]+[\s\S]*?\r?\n\s*catch\s*\{\s*\}\s*\r?\n',
  "`r`n"
)

# 2) Additional marker variant we used earlier
$src = [regex]::Replace(
  $src,
  '(?s)\r?\n\s*//\s*JRIDE_DISPATCH_ACTIONS_LOG_V6C[\s\S]*?\r?\n\s*catch\s*\{\s*\}\s*\r?\n',
  "`r`n"
)

# 3) If a direct bestEffortDispatchAction(...) call exists outside the marker, remove just that call (best-effort)
$src = [regex]::Replace(
  $src,
  '(?s)\r?\n\s*await\s+bestEffortDispatchAction\s*\([\s\S]*?\);\s*\r?\n',
  "`r`n"
)

if ($src -eq $orig) {
  throw "No API logging block found to remove (anchors not found). Not modifying file."
}

Write-Utf8NoBom -Path $path -Content $src
Write-Host "[OK] Removed API logging block(s) from: $path"

Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  npm.cmd run build"
