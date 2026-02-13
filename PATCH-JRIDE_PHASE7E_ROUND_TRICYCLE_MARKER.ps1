# PATCH-JRIDE_PHASE7E_ROUND_TRICYCLE_MARKER.ps1
# Frontend-only visual fix:
# - Use existing J-RIDE image
# - Crop to inner tricycle icon
# - Perfect round marker
# - No logic changes

$ErrorActionPreference = "Stop"

function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$map = "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $map)) { Fail "Missing file: $map" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $map "$map.bak.$stamp" -Force
Ok "Backup created: $map.bak.$stamp"

$txt = Get-Content $map -Raw

# We replace ONLY the driver marker element styling block
$before = @"
          const el = document.createElement("div");
el.style.width = "42px";
el.style.height = "42px";
el.style.borderRadius = "9999px";
el.style.background = "#111";
el.style.color = "#fff";
el.style.display = "flex";
el.style.alignItems = "center";
el.style.justifyContent = "center";
el.style.fontSize = "14px";
el.style.fontWeight = "700";
el.textContent = "D";
el.style.transform = "translate(-50%, -50%)";
if (isStuck || isProblem) el.classList.add("jride-marker-blink");
"@

$after = @"
          const el = document.createElement("div");
el.style.width = "44px";
el.style.height = "44px";
el.style.borderRadius = "50%";
el.style.overflow = "hidden";
el.style.backgroundImage = "url('/jride-logo.png')";
el.style.backgroundRepeat = "no-repeat";
el.style.backgroundSize = "160%";
el.style.backgroundPosition = "50% 45%"; // centers inner tricycle
el.style.boxShadow = "0 0 0 2px white";
el.style.transform = "translate(-50%, -50%)";
if (isStuck || isProblem) el.classList.add("jride-marker-blink");
"@

if (!$txt.Contains($before)) {
  Fail "Could not find driver marker element block to replace."
}

$txt = $txt.Replace($before, $after)
Set-Content -LiteralPath $map -Value $txt -Encoding UTF8
Ok "Tricycle marker styling applied."
