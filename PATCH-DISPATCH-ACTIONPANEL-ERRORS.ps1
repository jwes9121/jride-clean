# PATCH-DISPATCH-ACTIONPANEL-ERRORS.ps1
# Mirrors backend error codes in DispatchActionPanel UI (no layout changes)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\DispatchActionPanel.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# 1) Improve postJson error handling to surface backend `code`
$oldPostJson = @'
  if (!r.ok) {
    const msg = (j && (j.error || j.message)) || "REQUEST_FAILED";
    throw new Error(msg);
  }
'@

$newPostJson = @'
  if (!r.ok) {
    const code = j?.code || "REQUEST_FAILED";
    const msg = j?.message || code;
    const err: any = new Error(msg);
    err.code = code;
    throw err;
  }
'@

if ($t -notmatch [regex]::Escape($oldPostJson)) {
  Fail "Could not find original postJson error block."
}
$t = $t.Replace($oldPostJson, $newPostJson)

# 2) Add helper to translate error codes → human text
$helper = @'

  function explain(code?: string) {
    switch (code) {
      case "DRIVER_BUSY":
        return "Driver is already on an active trip.";
      case "ALREADY_ASSIGNED":
        return "This trip already has a driver.";
      case "NOT_ASSIGNABLE":
        return "Trip status does not allow assignment.";
      case "MISSING_BOOKING":
        return "Trip is missing booking reference.";
      case "MISSING_DRIVER":
        return "No driver selected.";
      case "NO_ROWS_UPDATED":
        return "Assignment was blocked by another update.";
      default:
        return null;
    }
  }

'@

# Insert helper after msg state
$rxMsgState = 'const\s+\[msg,\s*setMsg\]\s*=\s*useState<string>\(""\);'
if ($t -notmatch $rxMsgState) {
  Fail "Could not locate msg state to insert helper."
}
$t = [regex]::Replace($t, $rxMsgState, '$0' + $helper, 1)

# 3) Enhance Nudge + Emergency error handling (pattern-safe)
$t = $t.Replace(
  'setMsg(`Nudge failed: ${e?.message || "UNKNOWN_ERROR"}`);',
  'setMsg(explain(e?.code) || `Nudge failed: ${e?.message || "UNKNOWN_ERROR"}`);'
)

$t = $t.Replace(
  'setMsg(`Emergency failed: ${e?.message || "UNKNOWN_ERROR"}`);',
  'setMsg(explain(e?.code) || `Emergency failed: ${e?.message || "UNKNOWN_ERROR"}`);'
)

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: DispatchActionPanel error explanations added" -ForegroundColor Green
