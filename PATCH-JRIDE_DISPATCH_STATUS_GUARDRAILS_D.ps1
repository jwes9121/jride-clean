# PATCH-JRIDE_DISPATCH_STATUS_GUARDRAILS_D.ps1
# One file only: app\api\dispatch\status\route.ts
# PowerShell 5, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\api\dispatch\status\route.ts"
$path = Join-Path $root $rel
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# ---- 1) Strengthen idempotency response (label it) ----
$patIdem = '(?s)// Idempotent\s*\r?\n\s*if\s*\(\s*cur\s*===\s*target\s*\)\s*\{\s*return\s+jsonOk\s*\([\s\S]*?\)\s*;\s*\}'
if ($txt -notmatch $patIdem) {
  Fail "Idempotent block not found (cur === target)."
}

$idemReplace = @'
  // Idempotent (safe retry)
  if (cur === target) {
    return jsonOk({
      ok: true,
      changed: false,
      idempotent: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      status: booking.status ?? null,
      booking,
    });
  }
'@

$txt = [regex]::Replace($txt, $patIdem, $idemReplace, 1)
Ok "Labeled idempotent responses."

# ---- 2) Add stale-transition guard (detect race) ----
# Insert right before strict transition check
$anchorStrict = 'if \(!force && !allowedNext.includes\(target\)\) \{'
$idx = [regex]::Match($txt, $anchorStrict)
if (!$idx.Success) { Fail "Strict transition guard anchor not found." }

$staleBlock = @'
  // Stale transition guard: booking moved since client last saw it
  if (!force && booking.status && norm(booking.status) !== cur) {
    return jsonErr(
      "STALE_TRANSITION",
      "Booking status changed concurrently",
      409,
      {
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        server_status: norm(booking.status),
        requested_from: cur,
        requested_to: target,
      }
    );
  }

'@

$txt = $txt.Insert($idx.Index, $staleBlock)
Ok "Inserted stale transition guard."

# ---- 3) Early payload sanity (cheap abuse protection) ----
# Insert near start of POST after parsing body
$patAfterBody = '(?s)const\s+force\s*=\s*Boolean\(body\.force\);\s*'
$m = [regex]::Match($txt, $patAfterBody)
if (!$m.Success) { Fail "Could not locate body.force parsing anchor." }

$sanity = @'
  // Payload sanity (cheap guardrails)
  if (!body || (!body.booking_id && !body.booking_code)) {
    return jsonErr("BAD_REQUEST", "Missing booking identifier", 400);
  }
  if (!body.status) {
    return jsonErr("BAD_REQUEST", "Missing target status", 400);
  }

'@

$insertPos = $m.Index + $m.Length
$txt = $txt.Insert($insertPos, $sanity)
Ok "Added early payload sanity guards."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
