param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Write-Host "== PATCH JRIDE: dispatch/status allow driver secret header (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (-not (Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_DRIVER_SECRET_V1.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# 1) Insert helper functions near getActorFromReq (or after it)
if ($txt -notmatch "function isValidDriverSecret") {
  $anchor = "function getActorFromReq(req: Request): string {"
  $pos = $txt.IndexOf($anchor)
  if ($pos -lt 0) { throw "Could not locate getActorFromReq() anchor for helper insertion." }

  # Find end of getActorFromReq block by locating the next "}" after anchor and then newline
  $end = $txt.IndexOf("}", $pos)
  if ($end -lt 0) { throw "Could not locate end of getActorFromReq() for insertion." }
  # Insert after this closing brace (first one; function is short and already present)
  $end = $end + 1

  $helpers = @'

function isValidDriverSecret(req: Request): boolean {
  try {
    const want = String(process.env.DRIVER_PING_SECRET || process.env.DRIVER_API_SECRET || "").trim();
    if (!want) return false;
    const got = String(req.headers.get("x-driver-ping-secret") || "").trim();
    return !!(got && got === want);
  } catch {
    return false;
  }
}

function getDriverDeviceIdFromBody(body: any): string {
  const v = String(body?.device_id ?? body?.deviceId ?? body?.deviceID ?? "").trim();
  return v;
}

function getDriverIdFromBody(body: any): string {
  const v = String(body?.driver_id ?? body?.driverId ?? "").trim();
  return v;
}

'@

  $txt = $txt.Substring(0, $end) + $helpers + $txt.Substring($end)
  Write-Host "[OK] Inserted driver secret helper functions."
}

# 2) Patch POST auth gate to allow driver secret
# Locate POST gate block:
$gateNeedle = "if (!allowUnauth && !(wantSecret && gotSecret && gotSecret === wantSecret)) {"
$idx = $txt.IndexOf($gateNeedle)
if ($idx -lt 0) { throw "Could not locate POST auth gate 'if (!allowUnauth ...' block." }

# We'll inject driver-secret bypass BEFORE supabase.auth.getUser() is attempted.
# Find the line that contains "try {" right after this if.
$injectPoint = $txt.IndexOf("try {", $idx)
if ($injectPoint -lt 0) { throw "Could not locate try { inside POST auth gate." }

$inject = @'
    // DRIVER_SECRET_BYPASS_V1: Allow driver app to call dispatch/status using x-driver-ping-secret + device lock
    const bodyDriverId = getDriverIdFromBody(body);
    const bodyDeviceId = getDriverDeviceIdFromBody(body);
    const driverSecretOk = isValidDriverSecret(req);

    if (driverSecretOk && bodyDriverId && bodyDeviceId) {
      const lockOk = await ensureDriverDeviceLock(bodyDriverId, bodyDeviceId);
      if (!lockOk.ok) return jsonErr(lockOk.code, lockOk.message, lockOk.status, lockOk.extra);

      // Optional: ensure booking belongs to this driver if booking id/code is present (best effort gate)
      const owns = await enforceDriverOwnsBooking(bodyDriverId, body?.booking_id ?? body?.bookingId ?? null, body?.booking_code ?? body?.bookingCode ?? null);
      if (!owns.ok) return jsonErr(owns.code, owns.message, owns.status);

      actorUserId = bodyDriverId; // mark actor as driver id for audit
    } else {
'@

# We need to close the new else block right before the original try/catch auth.getUser logic ends.
# Find the "if (!actorUserId) {" inside the gate and insert a closing brace before it,
# but only for the else branch.
$unauthNeedle = "if (!actorUserId) {"
$unauthIdx = $txt.IndexOf($unauthNeedle, $idx)
if ($unauthIdx -lt 0) { throw "Could not locate 'if (!actorUserId) {' in POST gate." }

# Insert a closing brace for the else right before that unauth check, AFTER the try/catch block.
# We'll locate the end of the try/catch by finding the line "}" that closes catch and is followed by newline and spaces and then "if (!actorUserId)".
$pre = $txt.Substring(0, $unauthIdx)
$post = $txt.Substring($unauthIdx)

# If we've already patched, avoid double insert
if ($txt -match "DRIVER_SECRET_BYPASS_V1") {
  Write-Host "[WARN] dispatch/status already patched for driver secret. Skipping gate injection."
} else {
  # Inject the opening + else wrapper before original try
  $txt = $txt.Substring(0, $injectPoint) + $inject + $txt.Substring($injectPoint)

  # Now we need to close the else branch before the unauth check.
  # Find the unauth check again after injection (indexes changed)
  $idx2 = $txt.IndexOf($unauthNeedle, $idx)
  if ($idx2 -lt 0) { throw "Post-injection: could not locate 'if (!actorUserId) {'." }

  # Insert closing brace "}" to end the else branch right before unauth check
  $txt = $txt.Substring(0, $idx2) + "    }`r`n`r`n" + $txt.Substring($idx2)

  Write-Host "[OK] Injected driver-secret bypass into POST auth gate."
}

# 3) Ensure driver_id + device_id are accepted (device lock expects them)
# Currently your Android accept payload does NOT send device_id. We must allow that by adding it on Android later
# OR accept without lock. We'll keep lock requirement: driver app must send device_id.
# We'll just add a note comment in code (no functional change).

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $target"
Write-Host "Done."