# PATCH-JRIDE_LIVETRIPSCLIENT_REMOVE_VISIBILITY_IMMEDIATE_REFRESH_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }

$target = Join-Path $WebRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$raw = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Fail "Target file is empty: $target"
}

$backupDir = Join-Path $WebRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.REMOVE_VISIBILITY_IMMEDIATE_REFRESH_V1." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$old = @'
    const onVisibilityChange = () => {
      refreshAllRef.current?.("visibility").catch(() => {});
      schedule();
    };
'@

$new = @'
    const onVisibilityChange = () => {
      schedule();
    };
'@

if ($raw.IndexOf($old) -lt 0) {
  Fail "Could not locate onVisibilityChange block."
}

$raw = $raw.Replace($old, $new)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $raw, $utf8NoBom)
Ok "Patched: $target"

$verify = Get-Content -LiteralPath $target -Raw
if ($verify.IndexOf('refreshAllRef.current?.("visibility").catch(() => {});') -ge 0) {
  Fail "Verification failed: visibility immediate refresh still present."
}

Ok "Verification passed."
Write-Host "Now run: npm run build"