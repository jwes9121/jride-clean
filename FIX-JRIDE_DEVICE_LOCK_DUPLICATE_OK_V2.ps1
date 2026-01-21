# FIX-JRIDE_DEVICE_LOCK_DUPLICATE_OK_V2.ps1
# Fix TS error: duplicate 'ok' key caused by spreading ...lock (lock may contain ok)
# Patches both:
# - app/api/driver-heartbeat/route.ts
# - app/api/live-location/route.ts

$ErrorActionPreference = "Stop"
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$root = (Get-Location).Path
$files = @(
  (Join-Path $root "app\api\driver-heartbeat\route.ts"),
  (Join-Path $root "app\api\live-location\route.ts")
)

# Replace:
# NextResponse.json({ ok: false, error: "Device lock conflict", ...lock }, { status: 409 })
# With:
# NextResponse.json((() => { const { ok: _ok, ...lockRest } = lock as any; return { ok:false, error:"Device lock conflict", ...lockRest }; })(), { status: 409 })
$pattern = 'NextResponse\.json\(\s*\{\s*ok\s*:\s*false\s*,\s*error\s*:\s*"Device lock conflict"\s*,\s*\.\.\.\s*lock\s*\}\s*,'
$replacement = 'NextResponse.json((() => { const { ok: _ok, ...lockRest } = lock as any; return { ok: false, error: "Device lock conflict", ...lockRest }; })(),'

foreach ($p in $files) {
  if (!(Test-Path $p)) { Write-Host "[SKIP] Missing: $p"; continue }

  $ts = Stamp
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"

  $txt = Get-Content -Raw -LiteralPath $p

  $newTxt = [regex]::Replace($txt, $pattern, $replacement)

  if ($newTxt -eq $txt) {
    Write-Host "[WARN] No match found in: $p"
  } else {
    Set-Content -LiteralPath $p -Value $newTxt -Encoding UTF8
    Write-Host "[DONE] Patched: $p"
  }
}

Write-Host "[NEXT] npm.cmd run build"
