$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\api\dispatch\status\route.ts'
if (!(Test-Path $path)) { Fail "Missing: app\api\dispatch\status\route.ts (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

if ($txt -match 'PHASE3B_FIX_MISSING_IDENTIFIER_GATE') {
  Ok "[OK] Already patched (PHASE3B_FIX_MISSING_IDENTIFIER_GATE present)."
  exit 0
}

# Anchor on the exact reject message text
$anchor = 'Missing booking identifier'
$idx = $txt.IndexOf($anchor)
if ($idx -lt 0) {
  Fail "Could not find the text 'Missing booking identifier' in dispatch/status/route.ts. The reject message differs."
}

# Find the start of the enclosing if-block by scanning backward for the nearest 'if (' before the message
$ifStart = $txt.LastIndexOf("if", $idx)
if ($ifStart -lt 0) { Fail "Could not locate surrounding if(...) gate before reject message." }

# We will insert a normalization snippet just BEFORE that if(...)
$inject = @'
    // PHASE3B_FIX_MISSING_IDENTIFIER_GATE
    // Normalize booking identifiers from common payload variants before validating.
    // Accept: booking_id / bookingId / id ; booking_code / bookingCode / code
    const anyBody: any = (typeof body !== "undefined" ? (body as any) : ({} as any));
    const normBookingId =
      anyBody?.booking_id ??
      anyBody?.bookingId ??
      anyBody?.id ??
      anyBody?.booking?.id ??
      null;

    const normBookingCode =
      anyBody?.booking_code ??
      anyBody?.bookingCode ??
      anyBody?.code ??
      anyBody?.booking?.booking_code ??
      anyBody?.booking?.bookingCode ??
      null;

    if (normBookingId != null && String(normBookingId).trim() !== "") anyBody.booking_id = String(normBookingId).trim();
    if (normBookingCode != null && String(normBookingCode).trim() !== "") anyBody.booking_code = String(normBookingCode).trim();
'@

$txt2 = $txt.Substring(0, $ifStart) + $inject + $txt.Substring($ifStart)

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8)

Ok "[OK] Phase 3B applied: identifier aliases normalized before 'Missing booking identifier' gate."
Info "NEXT: npm run build"
