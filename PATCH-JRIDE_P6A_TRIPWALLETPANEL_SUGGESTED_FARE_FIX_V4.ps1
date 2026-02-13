# PATCH-JRIDE_P6A_TRIPWALLETPANEL_SUGGESTED_FARE_FIX_V4.ps1
# Fixes:
# 1) suggestedFare not defined (ensure const suggestedFare exists in component scope near fareDisplay)
# 2) broken JSX caused by prior injection (restore proper div structure)
#
# Anchor-based: finds the exact broken JSX pattern you have now and replaces it.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$ROOT = (Get-Location).Path
$Target = Join-Path $ROOT "app\admin\livetrips\components\TripWalletPanel.tsx"
if (!(Test-Path $Target)) { Fail "Missing file: $Target" }

# Backup
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
Copy-Item $Target ($Target + ".bak." + $ts) -Force
Ok "[OK] Backup: $Target.bak.$ts"

$txt = Get-Content -LiteralPath $Target -Raw
$enc = New-Object System.Text.UTF8Encoding($false)

# ---------------------------
# A) Fix broken JSX block
# We replace the malformed chunk that looks like:
# <div className="font-semibold">{fmtMoney(fareDisplay)}
# <div className="mt-1 ...">{fmtMoney(suggestedFare)}...</div></div>
# ---------------------------

$reBroken = [regex]::new('(?s)<div\s+className="font-semibold">\s*\{fmtMoney\(\s*fareDisplay\s*\)\}\s*<div\s+className="mt-1\s+text-xs\s+text-slate-500">\s*Suggested\s+verified\s+fare:\s*<span\s+className="font-medium\s+text-slate-700">\s*\{fmtMoney\(\s*suggestedFare\s*\)\}\s*</span>\s*</div>\s*</div>', 'IgnoreCase')
if (-not $reBroken.IsMatch($txt)) {
  Fail "Anchor not found: broken JSX block (font-semibold + suggested fare inline)."
}

$replacementJsx = @'
<div className="font-semibold">{fmtMoney(fareDisplay)}</div>
          <div className="mt-1 text-xs text-slate-500">
            Suggested verified fare: <span className="font-medium text-slate-700">{fmtMoney(suggestedFare)}</span>
          </div>
'@

$txt = $reBroken.Replace($txt, $replacementJsx, 1)
Ok "[OK] Repaired broken JSX structure for fareDisplay + suggestedFare line"

# ---------------------------
# B) Ensure suggestedFare is defined in the same component scope
# Insert immediately after the nearest "const fareDisplay = useMemo(...);" that appears BEFORE the JSX usage.
# We do: locate first occurrence of "{fmtMoney(fareDisplay)}" and then find the LAST "const fareDisplay" before it.
# ---------------------------

if ($txt -match 'const\s+suggestedFare\s*=') {
  Warn "[WARN] suggestedFare const already exists somewhere; ensuring it exists near fareDisplay (scope-safe)."
}

# Find where fareDisplay is used (first occurrence after our JSX repair)
$useIx = $txt.IndexOf('{fmtMoney(fareDisplay)}')
if ($useIx -lt 0) { Fail "Could not locate usage: {fmtMoney(fareDisplay)}" }

# Find last 'const fareDisplay' before that usage
$prefix = $txt.Substring(0, $useIx)
$lastFareIx = $prefix.LastIndexOf('const fareDisplay')
if ($lastFareIx -lt 0) { Fail "Could not locate 'const fareDisplay' before JSX usage" }

# Find end of that fareDisplay statement (ending with ');' or ');' + whitespace)
$afterFare = $txt.Substring($lastFareIx)
$mEnd = [regex]::Match($afterFare, '(?s)const\s+fareDisplay\s*=\s*useMemo\s*\([\s\S]*?\)\s*;\s*')
if (-not $mEnd.Success) { Fail "Could not capture fareDisplay useMemo statement end for insertion" }

$insertPos = $lastFareIx + $mEnd.Length

# Only insert if there's not already a suggestedFare declaration right after fareDisplay
$window = $txt.Substring($insertPos, [Math]::Min(400, $txt.Length - $insertPos))
if ($window -match 'const\s+suggestedFare\s*=') {
  Warn "[WARN] suggestedFare already declared near fareDisplay; skipping scope insert"
} else {
  $insertDecl = @'

  // P6A: Suggested verified fare (UI-only; wired later)
  const suggestedFare = asNum(
    trip?.suggested_verified_fare ??
    trip?.suggested_fare ??
    trip?.fare_suggestion ??
    trip?.suggestedFare ??
    null
  );

'@
  $txt = $txt.Substring(0, $insertPos) + $insertDecl + $txt.Substring($insertPos)
  Ok "[OK] Inserted suggestedFare const near fareDisplay (correct scope)"
}

[System.IO.File]::WriteAllText($Target, $txt, $enc)
Ok "[OK] Patched: app\admin\livetrips\components\TripWalletPanel.tsx"
Ok "DONE. Next: run build."
