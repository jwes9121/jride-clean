param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Ensure-Path([string]$p, [string]$label) {
  if (!(Test-Path -LiteralPath $p)) { throw ("Missing {0}: {1}" -f $label, $p) }
}

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }

Write-Host "== JRIDE Patch: Driver API auth bypass via driver_device_locks (V1 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host ("RepoRoot: {0}" -f $RepoRoot)

Ensure-Path $RepoRoot "RepoRoot"

$bakDir = Join-Path $RepoRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

# Find route.ts files under app/api that contain the UNAUTHORIZED pattern
$apiRoot = Join-Path $RepoRoot "app\api"
Ensure-Path $apiRoot "app\api"

$targets = Get-ChildItem -LiteralPath $apiRoot -Recurse -File -Filter "route.ts" |
  Where-Object {
    $txt = Get-Content -LiteralPath $_.FullName -Raw
    ($txt -match 'code\s*:\s*["'']UNAUTHORIZED["'']') -or ($txt -match 'Not authenticated')
  }

if (!$targets -or $targets.Count -eq 0) {
  throw "No app/api/**/route.ts files found containing UNAUTHORIZED/Not authenticated. Nothing to patch."
}

Write-Host ("Found {0} candidate route.ts files." -f $targets.Count) -ForegroundColor Yellow
$targets | ForEach-Object { Write-Host (" - {0}" -f $_.FullName) }

# Helper snippet to insert once per file (only if not present)
$helperSnippet = @"
function isDriverDeviceLockAllowed(body: any): boolean {
  // Minimal gate: require driver_id + device_id present
  if (!body) return false;
  const driver_id = body.driver_id || body.driverId;
  const device_id = body.device_id || body.deviceId;
  return !!(driver_id && device_id);
}
"@

foreach ($f in $targets) {
  $path = $f.FullName
  $src = Get-Content -LiteralPath $path -Raw

  $stamp = Stamp
  $bak = Join-Path $bakDir ("route.ts.bak.DRIVER_API_AUTH_BYPASS_V1.{0}.{1}" -f $stamp, ($path.GetHashCode()))
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host ("[OK] Backup: {0}" -f $bak) -ForegroundColor Green

  $out = $src

  # Insert helper only if not already present
  if ($out -notmatch 'function\s+isDriverDeviceLockAllowed\s*\(') {
    # Insert after imports (best-effort)
    if ($out -match '(?s)\A(.*?)(\r?\n\r?\n)') {
      $out = [regex]::Replace($out, '(?s)\A(.*?)(\r?\n\r?\n)', ('$1' + "`r`n`r`n" + $helperSnippet + "`r`n`r`n"), 1)
    } else {
      $out = $helperSnippet + "`r`n`r`n" + $out
    }
  }

  # Patch common auth gate patterns:
  # 1) if (!session) { return NextResponse.json({ ok:false, code:"UNAUTHORIZED", message:"Not authenticated" }, { status: 401 }); }
  # -> if (!session && !isDriverDeviceLockAllowed(body)) { ... }
  #
  # This assumes the handler has parsed body as `body` (or we add a best-effort parse near top).
  if ($out -notmatch 'const\s+body\s*=\s*await\s+req\.json\(\)') {
    # Try to insert body parse near start of handler for POST routes (best-effort)
    $out = [regex]::Replace(
      $out,
      '(?s)(export\s+async\s+function\s+POST\s*\(\s*req\s*:\s*Request[^)]*\)\s*\{\s*)',
      '$1' + "`r`n  const body = await req.json().catch(() => null);`r`n",
      1
    )
  }

  # Replace `if (!session) { return UNAUTHORIZED }` with extended condition
  $out2 = [regex]::Replace(
    $out,
    '(?s)if\s*\(\s*!\s*session\s*\)\s*\{\s*return\s+NextResponse\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*code\s*:\s*["'']UNAUTHORIZED["''][^}]*\}\s*,\s*\{\s*status\s*:\s*401\s*\}\s*\)\s*;\s*\}',
    'if (!session && !isDriverDeviceLockAllowed(body)) { return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "Not authenticated" }, { status: 401 }); }'
  )

  # Also patch direct returns without braces (best-effort)
  $out2 = [regex]::Replace(
    $out2,
    'return\s+NextResponse\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*code\s*:\s*["'']UNAUTHORIZED["''][^}]*\}\s*,\s*\{\s*status\s*:\s*401\s*\}\s*\)\s*;',
    'if (!isDriverDeviceLockAllowed(body)) { return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "Not authenticated" }, { status: 401 }); }'
  )

  if ($out2 -eq $src) {
    Write-Host ("[WARN] No changes applied to: {0} (pattern not matched safely)" -f $path) -ForegroundColor Yellow
    continue
  }

  Set-Content -LiteralPath $path -Value $out2 -Encoding UTF8
  Write-Host ("[OK] Patched: {0}" -f $path) -ForegroundColor Green
}

Write-Host "`n[NEXT] Rebuild + deploy, then retry driver Accept." -ForegroundColor Cyan