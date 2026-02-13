# FIX-JRIDE_LIVETRIPS_ISAVAIL_AND_MANUAL_DRIVER_AVAIL_V1.ps1
# Purpose:
# - Fix broken const isAvail syntax (restore as multi-line function)
# - Treat statuses: available OR online OR idle as "available"
# - Update manualDriverIsAvailable to match
# Safe: only edits app\admin\livetrips\LiveTripsClient.tsx

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw

# ---- Patch 1: replace the isAvail function line/block (handles broken one-liners too)
# We anchor on the comment that exists in your file: "// Available-first sorting"
if ($txt -notmatch [regex]::Escape("// Available-first sorting")) {
  Fail "Anchor not found: // Available-first sorting"
}

$reIsAvail = [regex]::new("const\s+isAvail\s*=\s*\(d:\s*any\)\s*=>\s*(\{.*?\}|[^;\r\n]+);", "Singleline")
if (-not $reIsAvail.IsMatch($txt)) {
  Fail "Could not find 'const isAvail = (d: any) => ...' to replace."
}

$goodIsAvail = @"
const isAvail = (d: any) => {
      const s = String(d?.status ?? "").trim().toLowerCase();
      return (s === "available" || s === "online" || s === "idle");
    };
"@

$txt = $reIsAvail.Replace($txt, $goodIsAvail, 1)

# ---- Patch 2: manualDriverIsAvailable return condition
$reManual = [regex]::new("return\s*\(\!s\s*\|\|\s*s\s*===\s*""available""\s*\);\s*", "Singleline")
if ($reManual.IsMatch($txt)) {
  $txt = $reManual.Replace($txt, "return (!s || s === ""available"" || s === ""online"" || s === ""idle"");`n      ", 1)
} else {
  Write-Host "[WARN] Could not find manualDriverIsAvailable return line in expected form. Skipping this patch safely."
}

Set-Content -Path $target -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Next: run build to confirm green."
