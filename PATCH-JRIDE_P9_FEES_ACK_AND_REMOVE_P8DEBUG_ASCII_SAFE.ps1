# PATCH-JRIDE_P9_FEES_ACK_AND_REMOVE_P8DEBUG_ASCII_SAFE.ps1
# ASCII-only. UTF8 no BOM output. Anchor-based only. UI-only passenger. No dispatch/status touches.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = $target + ".bak." + (Get-Date -Format "yyyyMMdd_HHmmss")
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -Raw -LiteralPath $target

# -------------------------------------------------------------------
# 1) Remove P8 debug panel block (dev-only) between markers
# -------------------------------------------------------------------
$reP8Dbg = [regex]::new("(?s)[`r`n]*\s*\/\*\s*=====+\s*JRIDE_P8_DEBUG_PANEL_BEGIN[\s\S]*?JRIDE_P8_DEBUG_PANEL_END\s*=====+\s*\*\/\s*[`r`n]*", "Singleline")
$txt2 = $reP8Dbg.Replace($txt, "`r`n")
if ($txt2 -eq $txt) {
  # If exact markers differ, try a simpler variant that matches BEGIN/END only
  $reP8Dbg2 = [regex]::new("(?s)[`r`n]*\s*\/\*\s*=====+\s*JRIDE_P8_DEBUG_PANEL_BEGIN[\s\S]*?\/\*\s*=====+\s*JRIDE_P8_DEBUG_PANEL_END\s*=====+\s*\*\/\s*[`r`n]*", "Singleline")
  $txt2b = $reP8Dbg2.Replace($txt, "`r`n")
  if ($txt2b -eq $txt) {
    Fail "ANCHOR NOT FOUND: Could not locate JRIDE_P8_DEBUG_PANEL_BEGIN/END block to remove."
  }
  $txt = $txt2b
} else {
  $txt = $txt2
}
Write-Host "[OK] Removed P8 debug panel block."

# -------------------------------------------------------------------
# 2) Fix mojibake in the P8 disclosure line without embedding non-ASCII in PS1.
#    Replace: {" "} <non-ascii> Extra fee:
#    With:    {" "} | Extra fee:
# -------------------------------------------------------------------
# Matches any single non-ASCII char using [^ -~]
$reMoj = [regex]::new('(\{" "\}\s*)[^ -~](\s*Extra fee:)', "Singleline")
$txtM = $reMoj.Replace($txt, '$1|$2')
$txt = $txtM
Write-Host "[OK] Sanitized non-ASCII bullet in P8 disclosure (regex-based)."

# -------------------------------------------------------------------
# 3) Add P9 state: const [p9FeesAck, setP9FeesAck] = useState(false);
#    Anchor after fareBusy state to avoid redeclare.
# -------------------------------------------------------------------
$anchorState = 'const \[fareBusy, setFareBusy\] = React\.useState<boolean>\(false\);'
if ($txt -notmatch $anchorState) {
  Fail "ANCHOR NOT FOUND: fareBusy state line not found."
}

# Prevent duplicate insert
if ($txt -match 'const \[p9FeesAck, setP9FeesAck\] = React\.useState<\s*boolean\s*>\(false\);') {
  Write-Host "[SKIP] P9 state already present."
} else {
  $insertState = @"
const [p9FeesAck, setP9FeesAck] = React.useState<boolean>(false); // P9 fees acknowledgement (UI-only)
"@
  $txt = [regex]::Replace(
    $txt,
    $anchorState,
    '$0' + "`r`n" + $insertState,
    1
  )
  Write-Host "[OK] Inserted P9 state."
}

# -------------------------------------------------------------------
# 4) Gate allowSubmit with p9FeesAck (UI-only)
#    Replace: geoOrLocalOk && ![
#    With:    geoOrLocalOk && p9FeesAck && ![
# -------------------------------------------------------------------
$anchorAllow = 'geoOrLocalOk && !\['
if ($txt -notmatch $anchorAllow) {
  Fail "ANCHOR NOT FOUND: allowSubmit geoOrLocalOk gating pattern not found."
}

# Prevent duplicate
if ($txt -match 'geoOrLocalOk && p9FeesAck && !\[') {
  Write-Host "[SKIP] allowSubmit already gated by p9FeesAck."
} else {
  $txt = [regex]::Replace($txt, $anchorAllow, 'geoOrLocalOk && p9FeesAck && ![', 1)
  Write-Host "[OK] Updated allowSubmit gating with p9FeesAck."
}

# -------------------------------------------------------------------
# 5) Add P9 UI block (checkbox) above Submit/Clear buttons.
#    Anchor: <div className="mt-5 flex flex-wrap gap-3 items-center">
# -------------------------------------------------------------------
$anchorBtns = '<div className="mt-5 flex flex-wrap gap-3 items-center">'
if ($txt -notmatch [regex]::Escape($anchorBtns)) {
  Fail "ANCHOR NOT FOUND: submit button row container not found."
}

# Prevent duplicate insert using markers
if ($txt -match 'JRIDE_P9_FEES_ACK_BEGIN') {
  Write-Host "[SKIP] P9 checkbox block already present."
} else {
  $p9Block = @"
  {/* ===== JRIDE_P9_FEES_ACK_BEGIN (UI-only) ===== */}
  <div className="w-full -mt-2 mb-1 rounded-2xl border border-black/10 bg-white p-3">
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={!!p9FeesAck}
        onChange={(e) => { try { setP9FeesAck(!!e.target.checked); } catch {} }}
        disabled={busy || bookingSubmitted}
      />
      <div className="text-sm">
        <div className="font-semibold">Fees acknowledgement</div>
        <div className="mt-1 text-xs opacity-80">
          I understand there is a platform fee (PHP {String(P4_PLATFORM_SERVICE_FEE)}) and that an extra pickup distance fee may apply if the assigned driver is farther than 1.5 km from the pickup point.
        </div>
        {!p9FeesAck ? (
          <div className="mt-2 text-xs rounded-lg border border-amber-200 bg-amber-50 p-2">
            Please tick the box to enable "Submit booking".
          </div>
        ) : null}
      </div>
    </div>
  </div>
  {/* ===== JRIDE_P9_FEES_ACK_END ===== */}
"@

  $txt = $txt.Replace($anchorBtns, $anchorBtns + "`r`n" + $p9Block)
  Write-Host "[OK] Inserted P9 checkbox block above submit buttons."
}

# -------------------------------------------------------------------
# Write back as UTF-8 (no BOM)
# -------------------------------------------------------------------
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Write-Host "[OK] Patch applied: P9 fees acknowledgement + P8 debug removed."
