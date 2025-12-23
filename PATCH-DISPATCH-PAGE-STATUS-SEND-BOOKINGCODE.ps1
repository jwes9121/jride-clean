# PATCH-DISPATCH-PAGE-STATUS-SEND-BOOKINGCODE.ps1
param(
  [string]$RepoRoot = (Get-Location).Path
)

function Fail($m){ throw $m }

$repo = Resolve-Path $RepoRoot
Set-Location $repo

$ui = "app\dispatch\page.tsx"
if (!(Test-Path $ui)) { Fail "Missing file: $ui" }

$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
Copy-Item $ui "$ui.bak.$stamp" -Force
Write-Host "[OK] Backup: $ui.bak.$stamp" -ForegroundColor Green

$txt = Get-Content $ui -Raw

# 1) If any payload uses slice/substr/substring on IDs, remove it
$txt2 = $txt
$txt2 = $txt2 -replace '(\bbookingId\s*:\s*[^,}\r\n]+)\.slice\(\s*0\s*,\s*8\s*\)', '$1'
$txt2 = $txt2 -replace '(\bbookingId\s*:\s*[^,}\r\n]+)\.substring\(\s*0\s*,\s*8\s*\)', '$1'
$txt2 = $txt2 -replace '(\bbookingId\s*:\s*[^,}\r\n]+)\.substr\(\s*0\s*,\s*8\s*\)', '$1'

# 2) Inject bookingCode into the JSON.stringify({ ... }) for /api/dispatch/status if not present
# We only touch object literals passed to JSON.stringify inside a fetch that targets /api/dispatch/status
$rx = '(?ms)(fetch\(\s*["'']\/api\/dispatch\/status["''][^;]*?body\s*:\s*JSON\.stringify\()\s*\{\s*(?![^}]*\bbookingCode\b)([^}]*)\}\s*\)'
if ($txt2 -match $rx) {
  $txt2 = [regex]::Replace($txt2, $rx, {
    param($m)

    $prefix = $m.Groups[1].Value
    $bodyInside = $m.Groups[2].Value

    # Try to infer the row variable used near bookingId: commonly "row", "r", "b", "item"
    # If we can find "bookingId:" in the object, infer var from "X.id"
    $var = "row"
    $m2 = [regex]::Match($bodyInside, 'bookingId\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\.')
    if ($m2.Success) { $var = $m2.Groups[1].Value }

    $inject = "bookingCode: ($var as any).booking_code ?? ($var as any).bookingCode ?? undefined, bookingId: ($var as any).id ?? ($var as any).uuid ?? ($var as any).bookingId ?? undefined, "

    # If object already has bookingId: ..., we keep it but still prepend bookingCode + safe bookingId fallback.
    # Remove any duplicate bookingId we just injected if original already has bookingId:
    $hasBookingId = [regex]::IsMatch($bodyInside, '\bbookingId\b\s*:')
    if ($hasBookingId) {
      $inject = "bookingCode: ($var as any).booking_code ?? ($var as any).bookingCode ?? undefined, "
    }

    return $prefix + "{ " + $inject + $bodyInside.Trim() + " })"
  }, 1)

  Write-Host "[OK] Patched /api/dispatch/status body to include bookingCode + full bookingId fallback" -ForegroundColor Green
} else {
  Write-Host "[WARN] Could not locate fetch('/api/dispatch/status' ... JSON.stringify({ ... })) in $ui" -ForegroundColor Yellow
  Write-Host "Paste the block around the status button handler (the onClick that calls /api/dispatch/status)." -ForegroundColor Yellow
}

# 3) Extra guard: block sending obviously-short IDs (like 7-8 chars)
# We add a tiny helper near the top if not present.
if ($txt2 -notmatch 'function\s+isShortId\(') {
  $helper = @'
function isShortId(v: any) {
  const s = String(v ?? "");
  // UUIDs are 36 chars; our "short" table IDs are usually 6-8 chars
  return s.length > 0 && s.length < 20;
}

'@

  # Insert after "use client" if present; else at top
  if ($txt2 -match '(?m)^\s*["'']use client["''];\s*\r?\n') {
    $txt2 = [regex]::Replace($txt2, '(?m)^\s*["'']use client["''];\s*\r?\n', ('$0' + "`n" + $helper), 1)
  } else {
    $txt2 = $helper + "`n" + $txt2
  }

  Write-Host "[OK] Added isShortId() helper" -ForegroundColor Green
}

# 4) Guard any payload that uses bookingId (if present): if short, prefer bookingCode
# This is a safe “fix-forward” without needing perfect context.
$txt2 = $txt2 -replace '(?ms)\bbookingId\s*:\s*([^,}\r\n]+)', 'bookingId: (isShortId($1) ? undefined : $1)'

Set-Content -Path $ui -Value $txt2 -Encoding UTF8
Write-Host "[DONE] Updated: $ui" -ForegroundColor Green

Write-Host "`nNow restart dev server:" -ForegroundColor Cyan
Write-Host "  Ctrl+C" -ForegroundColor DarkGray
Write-Host "  npm run dev" -ForegroundColor DarkGray
