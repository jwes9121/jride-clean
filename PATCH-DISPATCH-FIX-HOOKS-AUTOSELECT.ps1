# PATCH-DISPATCH-FIX-HOOKS-AUTOSELECT.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content -Raw -Path $file

# 1) Remove the illegal hook inside rows.map()
# Matches:
# // Auto-select first eligible driver if empty (dispatch UX)
# React.useEffect(() => { ... }, [...]);
$rxBadHook = [regex]'(?s)\r?\n\s*//\s*Auto-select first eligible driver if empty \(dispatch UX\)\s*\r?\n\s*React\.useEffect\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[[^\]]*\]\s*\);\s*'
if (-not $rxBadHook.IsMatch($txt)) {
  Fail "Could not find the in-row auto-select React.useEffect block. Search in page.tsx for: Auto-select first eligible driver"
}
$txt = $rxBadHook.Replace($txt, "`r`n")

# Also remove a leftover eslint-disable comment if present near that block
$txt = [regex]::Replace($txt, '(?m)^\s*//\s*eslint-disable-next-line\s+react-hooks/exhaustive-deps\s*\r?\n', '')

# 2) Insert ONE safe useEffect outside rows.map (before return)
# Anchor: right before `return (`
$anchor = [regex]'(?m)^\s*return\s*\(\s*$'
if (-not $anchor.IsMatch($txt)) { Fail "Could not find 'return (' anchor to insert safe effect before return()." }

$effect = @"
  // Auto-select first eligible driver per row (SAFE: one hook outside rows.map)
  React.useEffect(() => {
    setSelectedDriverByBookingId((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };

      for (const b of rows) {
        const bookingId = String(b.id);
        const alreadyAssigned = !!b.driver_id;
        if (alreadyAssigned) continue;
        if (next[bookingId]) continue;

        const townKey = normTown(b.town);
        const townDrivers = drivers.filter((d) => normTown(d.town) === townKey);

        const onlineDrivers = townDrivers.filter((d) => String(d.status || "").toLowerCase() === "online");
        const eligibleDrivers = forceAssign ? townDrivers : onlineDrivers;

        if (eligibleDrivers.length > 0) {
          next[bookingId] = eligibleDrivers[0].id;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [rows, drivers, forceAssign]);
"@

$txt = $anchor.Replace($txt, "$effect`r`n  return (`r`n", 1)

# 3) Sanity checks
if ($txt -match 'React\.useEffect\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[[^\]]*\]\s*\);\s*\r?\n\s*return\s*\(\s*<tr' ) {
  Fail "Sanity check: still looks like a useEffect is inside the row render. Aborting."
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Fixed hooks: removed in-row useEffect and added safe global auto-select effect." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open http://localhost:3000/dispatch" -ForegroundColor Cyan
Write-Host "3) Confirm: no 'Rendered more hooks' error, dropdown auto-selects first eligible driver" -ForegroundColor Cyan
