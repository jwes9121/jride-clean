# FIX-JRIDE_PHASE2D_RIDE_PAGE_HELPER_PLACEMENT.ps1
# Fix: Phase2D helper block was injected inside code (syntax error).
# Action: remove helper block wherever it is, then re-insert after imports (top-level).
# Only touches: app/ride/page.tsx
# Backup + UTF-8 no BOM

$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  try { $sw.Write($content) } finally { $sw.Dispose() }
}

$root = (Get-Location).Path
$path = Join-Path $root "app\ride\page.tsx"
if (!(Test-Path $path)) { Fail "Missing file: app\ride/page.tsx" }

$bak = "$path.bak.$(Stamp)"
Copy-Item -Force $path $bak
Ok "Backup: $bak"

$txt = Get-Content -Raw $path

$helper = @'
/* PHASE2D_TAKEOUT_PAYLOAD_HELPER_BEGIN */
function jridePhase2dPick(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && (obj as any)[k] != null) return (obj as any)[k];
  }
  return null;
}
function jridePhase2dItemsFromAny(anyScope: any): any[] {
  const cands = [
    jridePhase2dPick(anyScope, ["takeoutCart","cart","orderItems","items","takeoutItems","menuItems"]),
    jridePhase2dPick(anyScope, ["cartItems","takeout_cart","takeout_items"]),
  ];
  for (const c of cands) if (Array.isArray(c) && c.length) return c;
  return [];
}
function jridePhase2dVendorIdFromAny(anyScope: any): string {
  const v = jridePhase2dPick(anyScope, ["vendorId","vendor_id","activeVendorId","selectedVendorId","vendor"]);
  return String(v || "").trim();
}
function jridePhase2dNormalizeItems(items: any[]): any[] {
  return (items || [])
    .map((it: any) => {
      const menu_item_id = String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim();
      const quantity = Math.max(1, parseInt(String(it?.quantity ?? it?.qty ?? it?.count ?? 1), 10) || 1);
      const name = it?.name ?? it?.title ?? it?.label ?? null;
      const price = (typeof it?.price === "number" ? it.price : (it?.unit_price ?? it?.unitPrice ?? null));
      return menu_item_id ? { menu_item_id, quantity, name, price } : null;
    })
    .filter(Boolean);
}
/* PHASE2D_TAKEOUT_PAYLOAD_HELPER_END */
'@

# 1) Remove misplaced helper block wherever it exists
$rxBlock = [regex]::new('(?s)\r?\n?\s*/\*\s*PHASE2D_TAKEOUT_PAYLOAD_HELPER_BEGIN\s*\*/.*?/\*\s*PHASE2D_TAKEOUT_PAYLOAD_HELPER_END\s*\*/\s*\r?\n?', "Singleline")
$txt2 = $rxBlock.Replace($txt, "`r`n", 1)

# If it existed multiple times, remove all
$txt2 = $rxBlock.Replace($txt2, "`r`n")

# 2) Insert helper at top-level after imports
# Anchor: "use client" (optional) + consecutive import lines
$rxTop = [regex]::new('(?s)\A(\s*("use client";\s*\r?\n\s*)?((?:import[^\r\n]*\r?\n)+)\s*)', "Singleline")
if (-not $rxTop.IsMatch($txt2)) {
  Fail "Could not find top import block to insert helper after. Paste first 40 lines of app/ride/page.tsx."
}

# Only insert if not already present (after cleanup it should be absent)
if ($txt2 -notmatch 'PHASE2D_TAKEOUT_PAYLOAD_HELPER_BEGIN') {
  $txt2 = $rxTop.Replace($txt2, '$1' + "`r`n" + $helper + "`r`n`r`n", 1)
  Ok "Inserted Phase2D helper block after imports (top-level)."
} else {
  Info "Helper block already present after cleanup; skipping insert."
}

WriteUtf8NoBom $path $txt2
Ok "Fixed helper placement in app/ride/page.tsx"
