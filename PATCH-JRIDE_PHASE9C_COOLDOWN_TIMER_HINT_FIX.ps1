# PATCH-JRIDE_PHASE9C_COOLDOWN_TIMER_HINT_FIX.ps1
# UI-only: show "Nudged Xm ago (cooldown Ym)" during COOLDOWN.
# Robust anchors (regex). ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $path -Raw

# 0) If already patched, exit safely
if ($txt -match 'function\s+coolTextForTripKey\s*\(') {
  Ok "Phase 9C helper already present. No changes."
  exit 0
}

# 1) Insert helper right after function isProblemEffective(...) { ... }
$reFunc = '(?s)(\n\s*function\s+isProblemEffective\s*\(\s*t\s*:\s*TripRow\s*\)\s*:\s*boolean\s*\{\s*.*?\n\s*\}\s*\n)'
$m = [regex]::Match($txt, $reFunc)
if (!$m.Success) { Fail "Could not find isProblemEffective(t: TripRow): boolean { ... } block." }

$helper = @"
  function coolTextForTripKey(key: string): string | null {
    const t = (nudgedAt as any)[key] as number | undefined;
    if (!t) return null;
    const now = Date.now();
    const elapsedMs = Math.max(0, now - t);
    const remainMs = Math.max(0, NUDGE_COOLDOWN_MS - elapsedMs);
    const agoMin = Math.floor(elapsedMs / 60000);
    const leftMin = Math.ceil(remainMs / 60000);
    if (elapsedMs >= NUDGE_COOLDOWN_MS) return null;
    return "Nudged " + String(agoMin) + "m ago (cooldown " + String(leftMin) + "m)";
  }

"@

$txt = [regex]::Replace($txt, $reFunc, ('$1' + $helper), 1)
Ok "Inserted coolTextForTripKey after isProblemEffective."

# 2) Add coolText computation in row block (after prob line)
# We expect Phase 9B row variables include:
# const probRaw = ...
# const cooling = ...
# const prob = ...
$reRow = '(?m)^\s*const\s+prob\s*=\s*probRaw\s*&&\s*!cooling;\s*$'
if ($txt -notmatch $reRow) { Fail "Could not find row line: const prob = probRaw && !cooling;" }

if ($txt -notmatch '(?m)^\s*const\s+coolText\s*=\s*cooling\s*\?\s*coolTextForTripKey\(key\)\s*:\s*null;\s*$') {
  $txt = [regex]::Replace(
    $txt,
    $reRow,
    '                  const prob = probRaw && !cooling;' + "`n" +
    '                  const coolText = cooling ? coolTextForTripKey(key) : null;',
    1
  )
  Ok "Added coolText variable in row."
} else {
  Ok "coolText variable already present. Skipping."
}

# 3) Add hint text after the PROBLEM/COOLDOWN badge line
$badgeLine = '                          {prob ? <span className={badgeClass("problem")}>PROBLEM</span> : (cooling ? <span className={badgeClass("stale")}>COOLDOWN</span> : null)}'
$idx = $txt.IndexOf($badgeLine)
if ($idx -lt 0) { Fail "Could not find PROBLEM/COOLDOWN badge line to extend." }

$hint = @"
                          {cooling && coolText ? <span className="ml-2 text-xs text-gray-600">{coolText}</span> : null}
"@

# Avoid double insert
if ($txt -notmatch [regex]::Escape('{cooling && coolText ? <span className="ml-2 text-xs text-gray-600">{coolText}</span> : null}')) {
  $txt = $txt.Replace($badgeLine, $badgeLine + "`n" + $hint)
  Ok "Inserted cooldown hint text next to badge."
} else {
  Ok "Cooldown hint text already present. Skipping."
}

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $path"
Ok "Done."
