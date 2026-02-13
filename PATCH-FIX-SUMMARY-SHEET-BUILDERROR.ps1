# PATCH-FIX-SUMMARY-SHEET-BUILDERROR.ps1
# Restores app/dispatch/page.tsx from the most recent .bak.* and re-applies the SUMMARY sheet change safely.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes($path, $enc.GetBytes($text))
}

$target = "app\dispatch\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Find latest backup
$bak = Get-ChildItem -File -Path "app\dispatch" -Filter "page.tsx.bak.*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) { Fail "No backup found at app\dispatch\page.tsx.bak.*" }

Copy-Item $bak.FullName $target -Force
Write-Host "[OK] Restored from backup: $($bak.Name)" -ForegroundColor Green

$txt = Get-Content $target -Raw

# Guard checks
if ($txt -notmatch 'function\s+exportLguExcel\s*\(\)\s*\{') { Fail "exportLguExcel() not found in page.tsx" }
if ($txt -notmatch 'const\s+towns\s*=\s*\[') { Fail "const towns = [ ... ] not found in exportLguExcel()" }
if ($txt -notmatch 'const\s+sheets\s*=\s*\[') { Fail "const sheets = [ ... ] not found in exportLguExcel()" }

# 1) Insert SUMMARY helper block BEFORE "const towns = ["
$nl = [System.Environment]::NewLine

$summaryBlock = @"
    const SUMMARY_COLS = ["Municipality","Trips","Total_km","Total_fare_php","Avg_km","Avg_fare_php"];

    const sum2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

    const buildSummary = () => {
      const townsList = ["Kiangan", "Lagawe", "Hingyon", "Lamut", "Banaue"];
      const base = rowsSorted.filter((b) => {
        const s = normStatus(b.status);
        if (completedOnly && s !== "completed") return false;
        return true;
      });

      const calcFor = (townName: string | null) => {
        const items = townName ? base.filter((b) => pickTown(b.town) === townName) : base;

        let trips = 0;
        let totalKm = 0;
        let totalFare = 0;

        for (const b of items) {
          trips += 1;

          const km = Number(b.distance_km);
          if (Number.isFinite(km)) totalKm += km;

          const fare = Number(b.fare ?? b.verified_fare);
          if (Number.isFinite(fare)) totalFare += fare;
        }

        const avgKm = trips > 0 ? totalKm / trips : 0;
        const avgFare = trips > 0 ? totalFare / trips : 0;

        return {
          Municipality: townName || "ALL",
          Trips: String(trips),
          Total_km: sum2(totalKm),
          Total_fare_php: sum2(totalFare),
          Avg_km: sum2(avgKm),
          Avg_fare_php: sum2(avgFare),
        };
      };

      const rows = [ calcFor(null), ...townsList.map((t) => calcFor(t)) ];
      return { name: "SUMMARY", rows, cols: SUMMARY_COLS };
    };

"@

# Only insert if not already present
if ($txt -notmatch 'const\s+buildSummary\s*=\s*\(\)\s*=>') {
  $rxInsert = [regex]'(?s)(function\s+exportLguExcel\s*\(\)\s*\{.*?)(\s*const\s+towns\s*=\s*\[)'
  $m = $rxInsert.Match($txt)
  if (!$m.Success) { Fail "Failed locating insertion point before const towns = [" }

  $txt = $rxInsert.Replace($txt, { param($mm)
    $mm.Groups[1].Value + $nl + $summaryBlock + $nl + $mm.Groups[2].Value
  }, 1)

  Write-Host "[OK] Inserted SUMMARY helper block." -ForegroundColor Green
} else {
  Write-Host "[SKIP] SUMMARY helper already present." -ForegroundColor Yellow
}

# 2) Insert buildSummary() as FIRST sheet inside sheets array
# Turn: const sheets = [ makeSheet("ALL"... into: const sheets = [ buildSummary(), makeSheet("ALL"...
$rxSheets = [regex]'(?s)(const\s+sheets\s*=\s*\[\s*)(makeSheet\("ALL"|\s*makeSheet\("ALL")'
if ($txt -notmatch $rxSheets) {
  Fail "Could not find 'const sheets = [' followed by makeSheet(""ALL"") to insert SUMMARY."
}

if ($txt -notmatch 'buildSummary\(\)\s*,') {
  $txt = $rxSheets.Replace($txt, { param($mm)
    $mm.Groups[1].Value + "buildSummary()," + $nl + "      " + $mm.Groups[2].Value
  }, 1)
  Write-Host "[OK] Added SUMMARY sheet into sheets array." -ForegroundColor Green
} else {
  Write-Host "[SKIP] buildSummary() already included in sheets." -ForegroundColor Yellow
}

WriteUtf8NoBom $target $txt
Write-Host "[DONE] Rewrote: $target (UTF-8 no BOM)" -ForegroundColor Green
Write-Host "Next: npm.cmd run build" -ForegroundColor Yellow
