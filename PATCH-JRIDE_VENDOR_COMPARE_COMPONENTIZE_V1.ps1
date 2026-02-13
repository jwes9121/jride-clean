# PATCH-JRIDE_VENDOR_COMPARE_COMPONENTIZE_V1.ps1
# Replaces the inline "Free vs Premium (quick view)" block (including IIFE variants) with <VendorPlanCompare />
# Then injects a safe component definition in the same file.
# Targets: app/vendor-orders/page.tsx, app/vendor-orc/page.tsx, app/vendor-order/page.tsx (whichever exist)
# PS5-safe. Backups to _patch_bak.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

Ok "== JRide Patch: Vendor compare componentize (V1 / PS5-safe) =="
Info ("Repo root: {0}" -f $root)

$targets = @(
  (Join-Path $root "app\vendor-orders\page.tsx"),
  (Join-Path $root "app\vendor-orc\page.tsx"),
  (Join-Path $root "app\vendor-order\page.tsx")
) | Where-Object { Test-Path $_ }

if (-not $targets -or $targets.Count -eq 0) {
  throw "No vendor page found. Expected app/vendor-orders/page.tsx (and optionally vendor-orc/vendor-order)."
}

# Component definition (pure JSX, no map, no bullets, no emojis, ASCII-only prices)
$component = @'
function VendorPlanCompare() {
  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-800 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-slate-900">Free vs Premium (quick view)</div>
        <a
          href="/vendor/compare"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
        >
          Full comparison
        </a>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {/* FREE */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-900">FREE (Pilot)</div>
            <div className="text-[11px] text-slate-500">Vendor A</div>
          </div>

          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2 py-2">
            <div className="text-[11px] text-slate-500">Text-only menu (max 5)</div>

            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-800">Dinakdakan</div>
                <div className="text-[12px] font-semibold text-slate-900">P180</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-800">Native Chicken Soup</div>
                <div className="text-[12px] font-semibold text-slate-900">P220</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-800">Pinapaitan</div>
                <div className="text-[12px] font-semibold text-slate-900">P160</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-800">Hamburger</div>
                <div className="text-[12px] font-semibold text-slate-900">P120</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-800">Milk Tea</div>
                <div className="text-[12px] font-semibold text-slate-900">P90</div>
              </div>
            </div>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-slate-700 underline">See sample</summary>
            <div className="mt-2 text-[11px] text-slate-600">
              Customers see a simple text menu (fast and lightweight). Photos are not included.
            </div>
          </details>
        </div>

        {/* PREMIUM */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-emerald-900">PREMIUM</div>
            <div className="text-[11px] text-emerald-700">Vendor B</div>
          </div>

          <div className="mt-2 rounded-lg border border-emerald-200 bg-white px-2 py-2">
            <div className="text-[11px] text-emerald-900/80">
              Tap store to zoom, then swipe menu photos
            </div>

            <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
              <div className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden">
                <img src="/vendor-samples/dinakdakan.jpg" alt="Dinakdakan" className="h-28 w-full object-cover" loading="lazy" />
                <div className="p-2">
                  <div className="text-[12px] font-semibold text-slate-900">Dinakdakan</div>
                  <div className="text-[12px] text-slate-800">P180</div>
                  <button className="mt-1 w-full rounded-md bg-slate-900 py-1 text-[11px] text-white">Add</button>
                </div>
              </div>

              <div className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden">
                <img src="/vendor-samples/native-chicken-soup.jpg" alt="Native Chicken Soup" className="h-28 w-full object-cover" loading="lazy" />
                <div className="p-2">
                  <div className="text-[12px] font-semibold text-slate-900">Native Chicken Soup</div>
                  <div className="text-[12px] text-slate-800">P220</div>
                  <button className="mt-1 w-full rounded-md bg-slate-900 py-1 text-[11px] text-white">Add</button>
                </div>
              </div>

              <div className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden">
                <img src="/vendor-samples/pinapaitan.jpg" alt="Pinapaitan" className="h-28 w-full object-cover" loading="lazy" />
                <div className="p-2">
                  <div className="text-[12px] font-semibold text-slate-900">Pinapaitan</div>
                  <div className="text-[12px] text-slate-800">P160</div>
                  <button className="mt-1 w-full rounded-md bg-slate-900 py-1 text-[11px] text-white">Add</button>
                </div>
              </div>

              <div className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden">
                <img src="/vendor-samples/hamburger.jpg" alt="Hamburger" className="h-28 w-full object-cover" loading="lazy" />
                <div className="p-2">
                  <div className="text-[12px] font-semibold text-slate-900">Hamburger</div>
                  <div className="text-[12px] text-slate-800">P120</div>
                  <button className="mt-1 w-full rounded-md bg-slate-900 py-1 text-[11px] text-white">Add</button>
                </div>
              </div>

              <div className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden">
                <img src="/vendor-samples/milktea.jpg" alt="Milk Tea" className="h-28 w-full object-cover" loading="lazy" />
                <div className="p-2">
                  <div className="text-[12px] font-semibold text-slate-900">Milk Tea</div>
                  <div className="text-[12px] text-slate-800">P90</div>
                  <button className="mt-1 w-full rounded-md bg-slate-900 py-1 text-[11px] text-white">Add</button>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-emerald-900/80">
              Photos are auto-resized to save data and avoid large uploads.
            </div>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-emerald-900 underline">See sample</summary>
            <div className="mt-2 text-[11px] text-emerald-800/80">
              Premium feels like a real food app: zoom into the store and swipe the photo menu.
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
'@

# Replace block by anchoring: from "Free vs Premium (quick view)" up to just before "<OfflineIndicator />"
# This is robust even if the inside contains IIFEs, maps, comments, etc.
$blockPattern = '(?s)\s*<div className="mb-3[^"]*shadow-sm"[^>]*>.*?Free vs Premium \(quick view\).*?</div>\s*(?=\s*<OfflineIndicator\s*/>)'

foreach ($file in $targets) {
  Ok ""
  Ok ("-- Patching: {0}" -f $file)

  $bak = Join-Path $bakDir ((Split-Path $file -Leaf) + ".bak.$ts")
  Copy-Item -Force $file $bak
  Ok ("[OK] Backup: {0}" -f $bak)

  $txt = Get-Content -Raw -Path $file -Encoding UTF8

  # Remove mojibake bullets globally (safe)
  $txt = $txt.Replace("â€¢", "-")
  $txt = $txt.Replace("•", "-")

  if ([regex]::IsMatch($txt, $blockPattern)) {
    $txt = [regex]::Replace($txt, $blockPattern, "`r`n      <VendorPlanCompare />`r`n", 1)
    Ok "[OK] Replaced inline compare block with <VendorPlanCompare />"
  } else {
    Warn "[WARN] Compare block not found (skipped replace)."
  }

  # Inject component once, before "export default function"
  if ($txt -match "function\s+VendorPlanCompare\(") {
    Warn "[SKIP] VendorPlanCompare() already exists."
  } else {
    $exportIx = $txt.IndexOf("export default function")
    if ($exportIx -lt 0) {
      throw "Could not find 'export default function' to inject component before."
    }
    $txt = $txt.Substring(0, $exportIx) + $component + "`r`n`r`n" + $txt.Substring($exportIx)
    Ok "[OK] Injected VendorPlanCompare() component"
  }

  Set-Content -Path $file -Value $txt -Encoding UTF8
  Ok "[OK] Saved"
}

Ok ""
Ok "DONE. Next: npm.cmd run build"
