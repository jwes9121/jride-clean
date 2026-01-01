# REPAIR_AND_REAPPLY_PHASE8H_UI.ps1
# Restores LiveTripsClient.tsx from latest .bak and re-applies Phase 8H UI patch
# PS5-safe (no -replace scriptblock)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function ReadUtf8($p){
  $t = Get-Content $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function WriteUtf8NoBom($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}
function ReplaceOnce($txt, $pattern, $replacement, $label){
  $m = [regex]::Match($txt, $pattern)
  if(-not $m.Success){ Fail "Could not patch: $label" }
  return [regex]::Replace($txt, $pattern, $replacement, 1)
}
function InsertAfterOnce($txt, $pattern, $insertion, $label){
  $m = [regex]::Match($txt, $pattern)
  if(-not $m.Success){ Fail "Could not find anchor for: $label" }
  $idx = $m.Index + $m.Length
  return $txt.Substring(0,$idx) + $insertion + $txt.Substring($idx)
}

$ui = "app\admin\livetrips\LiveTripsClient.tsx"

if(!(Test-Path $ui)){ Fail "Missing file: $ui" }

# -----------------------------
# 1) Restore from latest backup
# -----------------------------
$bak = Get-ChildItem -Path "app\admin\livetrips" -Filter "LiveTripsClient.tsx.bak.*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $bak){ Fail "No LiveTripsClient.tsx.bak.* backups found. Cannot auto-restore." }

Copy-Item $bak.FullName $ui -Force
Ok "Restored LiveTripsClient.tsx from $($bak.Name)"

# Read restored file
$txt = ReadUtf8 $ui

# ---------------------------------------
# 2) Ensure callLiveTripsAction union type
# ---------------------------------------
if($txt -match 'function\s+callLiveTripsAction\(' -and $txt -notmatch '"ARCHIVE_TEST_TRIPS"'){
  # Replace only the union list inside action: "...|...|..."
  $pattern = '(function\s+callLiveTripsAction\(\s*action:\s*)([^)]*)(\)\s*\{)'
  $m = [regex]::Match($txt, $pattern)
  if($m.Success){
    $mid = $m.Groups[2].Value
    if($mid -match 'AUTO_ASSIGN'){
      $mid2 = $mid -replace 'AUTO_ASSIGN"\s*', 'AUTO_ASSIGN" | "ARCHIVE_TEST_TRIPS" '
      $txt = [regex]::Replace($txt, $pattern, ($m.Groups[1].Value + $mid2 + $m.Groups[3].Value), 1)
      Ok "Updated callLiveTripsAction() union to include ARCHIVE_TEST_TRIPS"
    } else {
      Warn "callLiveTripsAction() found but AUTO_ASSIGN not in union; skipped union update"
    }
  } else {
    Warn "callLiveTripsAction() signature not matched; skipped union update"
  }
}

# -----------------------------
# 3) Inject nudgedAt state
# -----------------------------
if($txt -notmatch '\[nudgedAt,\s*setNudgedAt\]'){
  $txt = ReplaceOnce $txt '(?s)(const\s+\[lastAction,\s*setLastAction\]\s*=\s*useState[^;]*;\s*)' ('$1' + "`r`n  const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});`r`n") "inject nudgedAt state"
  Ok "Injected nudgedAt state"
}

# -----------------------------
# 4) Add recentlyNudged helper
# -----------------------------
if($txt -notmatch 'function\s+recentlyNudged\('){
  if($txt -match 'function\s+minutesSince\('){
    $txt = InsertAfterOnce $txt '(?s)function\s+minutesSince\([\s\S]*?\}\s*' @"
`r`nfunction recentlyNudged(nudgedAt: Record<string, number>, key: string, windowMs = 2 * 60 * 1000) {
  const t = nudgedAt[key];
  if (!t) return false;
  return (Date.now() - t) < windowMs;
}
`r`n
"@ "add recentlyNudged after minutesSince"
    Ok "Added recentlyNudged() helper"
  } else {
    Fail "minutesSince() not found; cannot place recentlyNudged() helper safely."
  }
}

# -----------------------------
# 5) Patch isStale guard
# -----------------------------
if($txt -match 'function\s+isStale\(' -and $txt -notmatch 'recentlyNudged\(nudgedAt'){
  $txt = $txt -replace '(function\s+isStale\(\s*t:\s*TripRow\s*\)\s*\{\s*)', ('$1' + "`r`n  const k = tripKey(t);`r`n  if (recentlyNudged(nudgedAt, k)) return false;`r`n")
  Ok "Patched isStale() to hide STUCK briefly after Nudge"
}

# -----------------------------
# 6) Patch Nudge handler -> setNudgedAt
# -----------------------------
if($txt -match 'await\s+callLiveTripsAction\("NUDGE_DRIVER",\s*t\);\s*' -and $txt -notmatch 'setNudgedAt\(\(prev\)'){
  $txt = $txt -replace '(?s)(await\s+callLiveTripsAction\("NUDGE_DRIVER",\s*t\);\s*)', ('$1' + "setNudgedAt((prev) => ({ ...prev, [tripKey(t)]: Date.now() }));`r`n                                    ")
  Ok "Patched Nudge handler to record nudgedAt"
}

# -----------------------------
# 7) Add Archive TEST trips button
# -----------------------------
if($txt -notmatch 'Archive TEST trips'){
  $anchor = '(?s)(Problem trips\s*<span className="text-xs opacity-80">\{counts\.problem\}<\/span>\s*<\/button>)'
  if([regex]::IsMatch($txt, $anchor)){
    $btn = @'
$1

        <button
          className="rounded-full border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
          onClick={async () => {
            if (!confirm("Archive TEST trips older than 2 hours? This sets status=completed for TEST-% active trips.")) return;
            try {
              setLastAction("Archiving TEST trips...");
              await callLiveTripsAction("ARCHIVE_TEST_TRIPS", {} as any);
              setLastAction("Archived TEST trips");
              await loadPage();
            } catch (e: any) {
              setLastAction("Archive failed: " + String(e?.message || e));
            }
          }}
          title="Moves TEST-% active trips older than 2h into completed (dashboard cleanup)."
        >
          Archive TEST trips
        </button>
'@
    $txt = [regex]::Replace($txt, $anchor, $btn, 1)
    Ok "Inserted Archive TEST trips button"
  } else {
    Warn "Could not find Problem trips button anchor; skipped Archive button"
  }
}

# -----------------------------
# 8) Sorting (safe optional)
# If we can't safely replace visibleTrips useMemo, we skip to avoid breaking UI.
# -----------------------------
if($txt -match 'const\s+visibleTrips\s*=\s*useMemo\(' -and $txt -notmatch 'Sort:\s*problem first'){
  Warn "Sorting patch skipped for safety (to avoid another fragile rewrite). UI still works; we can add sorting in a dedicated script after build passes."
}

# Write back
WriteUtf8NoBom $ui $txt
Ok "Repaired + reapplied Phase 8H UI changes"
