param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE Patch: Force-visible fleet driver marker + always-open popup (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bak = BackupFile $mapPath "LIVETRIPSMAP_FLEET_POPUP_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

if ($txt -notmatch "FLEET DRIVER MARKERS") {
  Fail "[FAIL] Could not find 'FLEET DRIVER MARKERS' section. This patch expects the fleet-marker version."
}

# 1) Replace marker element sizing to BIG (40px) if we can find the creation block.
# We patch only the div style portion to avoid breaking logic.
$createPattern = '(?ms)const\s+el\s*=\s*document\.createElement\("div"\);\s*el\.style\.width\s*=\s*"[0-9]+px";\s*el\.style\.height\s*=\s*"[0-9]+px";\s*el\.style\.borderRadius\s*=\s*"9999px";\s*el\.style\.border\s*=\s*"2px solid #ffffff";\s*el\.style\.boxShadow\s*=\s*"0 1px 4px rgba\(0,0,0,0\.25\)";\s*el\.title\s*=\s*title;'
if ($txt -match $createPattern) {
  $createReplacement = @'
const el = document.createElement("div");
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.borderRadius = "9999px";
        el.style.border = "3px solid #ffffff";
        el.style.boxShadow = "0 2px 10px rgba(0,0,0,0.45)";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontSize = "11px";
        el.style.fontWeight = "800";
        el.style.color = "#ffffff";
        el.style.zIndex = "9999";
        el.title = title;
'@
  $txt = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    $createPattern,
    $createReplacement,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  Ok "[OK] Fleet marker element resized to 40px."
} else {
  Warn "[WARN] Could not match marker creation style block. Continuing (popup injection will still work)."
}

# 2) Inject popup + label near the end of each driver loop.
# We insert right before: nextFleet[id] = marker;
$nextFleetPattern = '(?ms)\r?\n\s*nextFleet\[id\]\s*=\s*marker;\s*\r?\n'
if ($txt -notmatch $nextFleetPattern) {
  Fail "[FAIL] Could not locate 'nextFleet[id] = marker;' to inject popup."
}

# Avoid double-injection
if ($txt -match "JRIDE_FLEET_POPUP_INJECT_V1") {
  Warn "[WARN] Popup inject already present. No changes made."
  WriteUtf8NoBom $mapPath $txt
  Ok "[NEXT] Run: npm.cmd run build"
  exit 0
}

$injectBlock = @'
      
      // JRIDE_FLEET_POPUP_INJECT_V1
      // Make fleet driver impossible to miss: label + always-open popup
      try {
        const label = stale ? "STALE" : (isOnline ? "ON" : "OFF");
        const el2 = marker.getElement() as HTMLDivElement;
        el2.textContent = label;
        el2.style.zIndex = "9999";

        const anyMarker: any = marker as any;
        if (!anyMarker.__jrideFleetPopup) {
          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 18 })
            .setHTML(`<div style="font-size:12px;font-weight:800;">FLEET: ${label}</div>
                      <div style="font-size:11px;">${(d.town ?? "")}</div>
                      <div style="font-size:10px;opacity:0.85;">${String(d.updated_at ?? "")}</div>`);
          marker.setPopup(popup);
          popup.addTo(map);
          anyMarker.__jrideFleetPopup = popup;
        } else {
          anyMarker.__jrideFleetPopup.setHTML(`<div style="font-size:12px;font-weight:800;">FLEET: ${label}</div>
                      <div style="font-size:11px;">${(d.town ?? "")}</div>
                      <div style="font-size:10px;opacity:0.85;">${String(d.updated_at ?? "")}</div>`);
          anyMarker.__jrideFleetPopup.addTo(map);
        }
      } catch {
        // ignore
      }

'@

$txt = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  $nextFleetPattern,
  $injectBlock + "`r`n      nextFleet[id] = marker;`r`n",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

WriteUtf8NoBom $mapPath $txt
Ok "[OK] Injected always-open popup + label for fleet drivers."
Ok "[NEXT] Run: npm.cmd run build"