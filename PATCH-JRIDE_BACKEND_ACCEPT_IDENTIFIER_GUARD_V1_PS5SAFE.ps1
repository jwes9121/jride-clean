param(
  [Parameter(Mandatory=$true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File {
  param([string]$Path,[string]$Tag)
  $bakDir = Join-Path (Split-Path -Parent $Path) "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path -Leaf $Path) + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$routePath = Join-Path $RepoRoot "app\api\dispatch\status\route.ts"

if (-not (Test-Path $routePath)) {
  throw "File not found: $routePath"
}

Backup-File -Path $routePath -Tag "BACKEND_ACCEPT_IDENTIFIER_GUARD_V1"

$content = Get-Content -LiteralPath $routePath -Raw

$old = @'
      if (!bookingId && !bookingCode) {
        return NextResponse.json({
          ok: false,
          code: "BOOKING_ID_MISSING",
          message: "Booking id or booking code required",
        });
      }
'@

$new = @'
      if (!bookingId && !bookingCode) {
        return NextResponse.json({
          ok: false,
          code: "BOOKING_ID_MISSING",
          message: "Booking id or booking code required",
          debug: {
            driver_id: driverId ?? null,
            booking_id: bookingId ?? null,
            booking_code: bookingCode ?? null,
            status: status ?? null,
          },
        });
      }
'@

if (-not $content.Contains($old)) {
  throw "Missing anchor for BOOKING_ID_MISSING block"
}

$content = $content.Replace($old, $new)

if (-not $content.Contains('debug: {')) {
  throw "Verification failed: debug block not inserted"
}

Write-Utf8NoBom -Path $routePath -Content $content
Write-Host "[OK] Patched $routePath"
Write-Host ""
Write-Host "DONE: dispatch/status now returns clearer missing-identifier debug info."