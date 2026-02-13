# PATCH-DISPATCH-LGU-DATERANGE-FIXED2.ps1
# Adds Today / This week / Custom date range filter for LGU exports (client-side only)
# Backup first. Uses .NET Regex.Replace (no PowerShell -replace pitfalls).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes($path, $enc.GetBytes($text))
}

$target = "app\dispatch\page.tsx"
if (!(Test-Path $target)) { Fail "Missing $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

if ($txt -notmatch "export default function DispatchPage") { Fail "DispatchPage not found in $target" }
if ($txt -notmatch "const rowsForExport = useMemo") { Fail "rowsForExport not found in $target" }
if ($txt -match "type DateRangeMode") {
  Write-Host "[INFO] Date range already present. Aborting to avoid double insert." -ForegroundColor Yellow
  exit 0
}

# 1) Insert state + helpers right after completedOnly state
$rxControls = New-Object System.Text.RegularExpressions.Regex('(?s)(const\s*\[muniFilter.*?\]\s*=\s*useState.*?;\s*.*?const\s*\[completedOnly.*?\]\s*=\s*useState.*?;\s*)')
$m = $rxControls.Match($txt)
if (!$m.Success) { Fail "Could not find muniFilter + completedOnly state block." }

$rangeBlock = @"
  // Date range filter (LGU exports only; no DB changes)
  type DateRangeMode = "today" | "week" | "custom";
  const [rangeMode, setRangeMode] = useState<DateRangeMode>("week");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function startOfWeekMonday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    d.setDate(d.getDate() + diff);
    return d;
  }

  function getRangeOrNull() {
    if (rangeMode === "today") return { from: startOfToday(), to: endOfToday() };
    if (rangeMode === "week") return { from: startOfWeekMonday(), to: endOfToday() };
    if (rangeMode === "custom") {
      if (!rangeFrom || !rangeTo) return null;
      return {
        from: new Date(rangeFrom + "T00:00:00"),
        to: new Date(rangeTo + "T23:59:59"),
      };
    }
    return null;
  }

"@

$txt = $rxControls.Replace($txt, $m.Groups[1].Value + "`n" + $rangeBlock, 1)
Write-Host "[OK] Inserted date range state + helpers." -ForegroundColor Green

# 2) Insert const range = getRangeOrNull(); after wantedStatus line inside rowsForExport
$rxWanted = New-Object System.Text.RegularExpressions.Regex('(?s)(const\s+rowsForExport\s*=\s*useMemo\s*\(\s*\(\)\s*=>\s*\{\s*.*?const\s+wantedStatus\s*=\s*completedOnly\s*\?\s*["'']completed["'']\s*:\s*null;\s*)')
$mw = $rxWanted.Match($txt)
if (!$mw.Success) { Fail "Could not find wantedStatus in rowsForExport." }

$txt = $rxWanted.Replace($txt, $mw.Groups[1].Value + "`n    const range = getRangeOrNull();`n", 1)
Write-Host "[OK] Inserted range const in rowsForExport." -ForegroundColor Green

# 3) Add date checks after muniFilter line inside rowsForExport
$rxMuniLine = New-Object System.Text.RegularExpressions.Regex('if\s*\(\s*muniFilter\s*!==\s*["'']All["'']\s*&&\s*town\s*!==\s*muniFilter\s*\)\s*return\s+false;\s*')
$mm = $rxMuniLine.Match($txt)
if (!$mm.Success) { Fail "Could not find muniFilter return false line in rowsForExport." }

$inject = @"
if (muniFilter !== "All" && town !== muniFilter) return false;
      if (range) {
        if (!b.created_at) return false;
        const d = new Date(b.created_at);
        if (Number.isNaN(d.getTime())) return false;
        if (d < range.from || d > range.to) return false;
      }
"@

$txt = $rxMuniLine.Replace($txt, $inject + "`n", 1)
Write-Host "[OK] Added date range filtering by created_at." -ForegroundColor Green

# 4) Insert UI after Municipality select block in LGU bar
$rxAfterMunicipality = New-Object System.Text.RegularExpressions.Regex('(?s)(<div className="flex items-center gap-2">\s*<span className="text-xs text-slate-600">Municipality</span>\s*<select.*?</select>\s*</div>)')
$mu = $rxAfterMunicipality.Match($txt)
if (!$mu.Success) { Fail "Municipality select block not found in LGU bar." }

$dateUi = @"
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Date range</span>
          <select
            className="h-8 rounded border px-2 text-sm"
            value={rangeMode}
            onChange={(e) => setRangeMode(e.target.value as any)}
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {rangeMode === "custom" ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="h-8 rounded border px-2 text-sm"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              className="h-8 rounded border px-2 text-sm"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
            />
          </div>
        ) : null}

"@

$txt = $rxAfterMunicipality.Replace($txt, $mu.Groups[1].Value + "`n" + $dateUi, 1)
Write-Host "[OK] Inserted date range UI in LGU bar." -ForegroundColor Green

WriteUtf8NoBom $target $txt
Write-Host "[DONE] Patched $target" -ForegroundColor Green
Write-Host "Next: npm.cmd run build" -ForegroundColor Yellow
