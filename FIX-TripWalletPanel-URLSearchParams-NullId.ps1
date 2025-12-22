# FIX-TripWalletPanel-URLSearchParams-NullId.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$rel  = "app\admin\livetrips\components\TripWalletPanel.tsx"
$path = Join-Path $root $rel
if (!(Test-Path $path)) { Fail "Missing file: $rel (run from repo root)" }

$txt = Get-Content -Raw -Path $path

# Replace the URLSearchParams block to avoid id: string|null typing issue
$needle = 'const qs = new URLSearchParams({ kind, id, limit: "20" });'
if ($txt -notmatch [regex]::Escape($needle)) { Fail "Could not find expected line to patch: $needle" }

$replacement = @'
const idStr = String(id);
        const qs = new URLSearchParams({ kind, id: idStr, limit: "20" });
'@

$txt = $txt.Replace($needle, $replacement)

Set-Content -Path $path -Value $txt -Encoding UTF8
Write-Host "[OK] Patched $rel (id null typing fix)" -ForegroundColor Green
Write-Host "[NEXT] Run: npm run build" -ForegroundColor Cyan
