# PATCH-JRIDE_VENDOR_SAMPLE_MENU_COMPARE_V1.ps1
# Patches ONLY the VendorPlanCompare() block in app/vendor-orders/page.tsx
# - Removes "Add" buttons
# - Uses one SAMPLE_MENU array (single source of truth)
# - Adds clear hint + CTA buttons
# - Writes UTF-8 (no BOM)
# - Creates a timestamped backup

$ErrorActionPreference = "Stop"

function Die($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Ok($m)  { Write-Host $m -ForegroundColor Green }

$RepoRoot = (Get-Location).Path
$Target   = Join-Path $RepoRoot "app\vendor-orders\page.tsx"

if (!(Test-Path $Target)) {
  Die "Target not found: $Target`nRun this from your repo root (C:\Users\jwes9\Desktop\jride-clean-fresh)."
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("vendor-orders.page.tsx.bak.$stamp")
Copy-Item -Force $Target $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -LiteralPath $Target

# New VendorPlanCompare block (ASCII only; canonical image paths)
$newBlock = @'
function VendorPlanCompare() {
  const SAMPLE_MENU = [
    { label: "Dinakdakan",            price: "P180", img: "/vendor-samples/dinakdakan.jpg" },
    { label: "Native Chicken Soup",   price: "P220", img: "/vendor-samples/native-chicken-soup.jpg" },
    { label: "Pinapaitan",            price: "P160", img: "/vendor-samples/pinapaitan.jpg" },
    { label: "Hamburger",             price: "P120", img: "/vendor-samples/hamburger.jpg" },
    { label: "Milk Tea",              price: "P90",  img: "/vendor-samples/milktea.jpg" },
  ];

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
              {SAMPLE_MENU.map((m) => (
                <div key={"free-" + m.label} className="flex items-center justify-between gap-2">
                  <div className="text-[12px] text-slate-800">{m.label}</div>
                  <div className="text-[12px] font-semibold text-slate-900">{m.price}</div>
                </div>
              ))}
            </div>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-slate-700 underline">See sample</summary>
            <div className="mt-2 text-[11px] text-slate-600">
              Customers see a simple text menu (fast and lightweight). Photos are not included.
            </div>
          </details>

          <div className="mt-3">
            <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800">
              Start Free
            </button>
          </div>
        </div>

        {/* PREMIUM */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-emerald-900">PREMIUM</div>
            <div className="text-[11px] text-emerald-700">Vendor B</div>
          </div>

          <div className="mt-2 rounded-lg border border-emerald-200 bg-white px-2 py-2">
            <div className="text-[11px] text-emerald-900/80">
              Tap photo to zoom - Swipe to browse
            </div>

            <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
              {SAMPLE_MENU.map((m) => (
                <div
                  key={"prem-" + m.label}
                  className="min-w-[200px] max-w-[200px] rounded-lg border border-emerald-200 bg-white overflow-hidden"
                >
                  <img
                    src={m.img}
                    alt={m.label}
                    className="h-28 w-full object-cover"
                    loading="lazy"
                  />
                  <div className="p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-slate-900">{m.label}</div>
                      <div className="text-[12px] font-semibold text-slate-900">{m.price}</div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Photo menu + swipeable gallery
                    </div>
                  </div>
                </div>
              ))}
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

          <div className="mt-3">
            <button className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-600">
              Upgrade to Premium
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
'@

# Replace VendorPlanCompare() function block only
$pattern = '(?s)function\s+VendorPlanCompare\s*\(\)\s*\{.*?\}\s*\n\s*\nexport\s+default\s+function\s+VendorOrdersPage'
if ($src -notmatch $pattern) {
  Die "Could not locate VendorPlanCompare() block (pattern mismatch)."
}

$updated = [regex]::Replace(
  $src,
  $pattern,
  ($newBlock + "`r`n`r`nexport default function VendorOrdersPage"),
  1
)

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Target, $updated, $utf8NoBom)

Ok "[OK] Patched: $Target"
Ok "[OK] VendorPlanCompare cleaned: single SAMPLE_MENU, no Add buttons, stronger CTA."
