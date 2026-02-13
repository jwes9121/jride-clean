# PATCH-JRIDE_TAKEOUT_MENU_FALLBACK_TO_ITEMS.ps1
# Unblock Phase 2B: /api/takeout/menu falls back to vendor_menu_items when vendor_menu_today returns 0 rows
# UTF-8 no BOM + backup

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$apiFile = Join-Path $root "app\api\takeout\menu\route.ts"
if (!(Test-Path $apiFile)) { Fail "Missing file: $apiFile" }

Copy-Item -Force $apiFile "$apiFile.bak.$ts"
Ok "Backup: $apiFile.bak.$ts"

$txt = [System.IO.File]::ReadAllText($apiFile)

# Anchor: locate the vendor_menu_today query
$anchor = '.from("vendor_menu_today")'
if ($txt -notmatch [regex]::Escape($anchor)) {
  Fail "Anchor not found: $anchor`nPaste app/api/takeout/menu/route.ts (first 200 lines)."
}

# Replace the whole GET handler body after vendor_id validation with a robust implementation.
# We replace from: "  // Read from the view" up to the final return json(...)
$pat = "(?s)\s*//\s*Read from the view.*?return\s+json\(\s*200\s*,\s*\{\s*ok:\s*true.*?\}\s*\)\s*;\s*\}"
if ($txt -notmatch $pat) {
  Fail "Could not locate the GET handler query+mapping block automatically.`nPaste lines 1-220 of app/api/takeout/menu/route.ts."
}

$repl = @'
  // Read from the view (canonical for "today" availability).
  // If the view returns 0 rows (due to strict view logic), fall back to vendor_menu_items (MVP safety).
  const q1 = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendor_id);

  if (q1.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: q1.error.message });
  }

  let rows: any[] = Array.isArray(q1.data) ? (q1.data as any[]) : [];

  // Fallback: base items table (active only)
  if (!rows.length) {
    const q2 = await admin
      .from("vendor_menu_items")
      .select("*")
      .eq("vendor_id", vendor_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (q2.error) {
      return json(500, { ok: false, error: "DB_ERROR", message: q2.error.message });
    }
    rows = Array.isArray(q2.data) ? (q2.data as any[]) : [];
  }

  const items = rows
    .map((r: any) => ({
      // normalize best-effort
      id: r.menu_item_id ?? r.id ?? null,
      vendor_id: r.vendor_id ?? vendor_id,
      name: r.name ?? r.item_name ?? null,
      description: r.description ?? null,
      price: r.price ?? r.unit_price ?? null,
      sort_order: r.sort_order ?? 0,

      // availability flags (best-effort)
      is_available:
        (typeof r.is_available === "boolean" ? r.is_available : null) ??
        (typeof r.is_available_today === "boolean" ? r.is_available_today : null) ??
        (typeof r.available_today === "boolean" ? r.available_today : null) ??
        (typeof r.available === "boolean" ? r.available : null) ??
        true, // base-table fallback defaults to available

      sold_out_today:
        (typeof r.sold_out_today === "boolean" ? r.sold_out_today : null) ??
        (typeof r.is_sold_out_today === "boolean" ? r.is_sold_out_today : null) ??
        false, // base-table fallback defaults to not sold out

      last_updated_at: r.last_updated_at ?? r.updated_at ?? r.created_at ?? null,
    }))
    .filter((x: any) => x.id && x.name);

  return json(200, { ok: true, vendor_id, items });
}
'@

$txt2 = [regex]::Replace($txt, $pat, $repl, 1)

[System.IO.File]::WriteAllText($apiFile, $txt2, $utf8NoBom)
Ok "Patched: $apiFile"
Ok "Takeout menu API now falls back to vendor_menu_items when view returns 0 rows."
