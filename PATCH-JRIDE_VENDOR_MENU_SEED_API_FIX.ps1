# PATCH-JRIDE_VENDOR_MENU_SEED_API_FIX.ps1
# Fix Phase 2A/2B blocker: Seed menu item button has no working API.
# Creates: app/api/admin/vendor-menu-items/route.ts
# Patches: app/admin/vendors/page.tsx (remove mojibake "âœ“")
# UTF-8 no BOM + backups

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$vendorsPage = Join-Path $root "app\admin\vendors\page.tsx"
if (!(Test-Path $vendorsPage)) { Fail "Missing file: $vendorsPage" }

$apiDir = Join-Path $root "app\api\admin\vendor-menu-items"
if (!(Test-Path $apiDir)) { New-Item -ItemType Directory -Force -Path $apiDir | Out-Null; Ok "Created dir: $apiDir" }
$apiFile = Join-Path $apiDir "route.ts"

# Backups
Copy-Item -Force $vendorsPage "$vendorsPage.bak.$ts"
Ok "Backup: $vendorsPage.bak.$ts"
if (Test-Path $apiFile) { Copy-Item -Force $apiFile "$apiFile.bak.$ts"; Ok "Backup: $apiFile.bak.$ts" }

# Write API
$api = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

// POST /api/admin/vendor-menu-items
// Body: { vendor_id, name, price, description?, sort_order? }
export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = await req.json().catch(() => ({} as any));

    const vendor_id = s(body.vendor_id ?? body.vendorId);
    const name = s(body.name);
    const description = (body.description === null || body.description === undefined) ? null : s(body.description);
    const price = n(body.price);
    const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;

    if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
    if (!name) return json(400, { ok: false, error: "name_required", message: "name required" });
    if (!Number.isFinite(price)) return json(400, { ok: false, error: "price_invalid", message: "price must be numeric" });

    const insertRow: any = {
      vendor_id,
      name,
      description,
      price,
      sort_order,
      is_active: true,
    };

    const { data, error } = await admin
      .from("vendor_menu_items")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

    return json(200, { ok: true, item: data });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}
'@

[System.IO.File]::WriteAllText($apiFile, $api, $utf8NoBom)
Ok "Wrote: $apiFile"

# Patch mojibake in Vendors admin page (do not embed weird chars; just replace the exact snippet)
$txt = [System.IO.File]::ReadAllText($vendorsPage)

# Replace "Added âœ✓" or any non-ascii checkmark residue by forcing "Added OK"
$txt2 = $txt
$txt2 = $txt2 -replace "Added\s+[^""']+", "Added OK"

if ($txt2 -ne $txt) {
  [System.IO.File]::WriteAllText($vendorsPage, $txt2, $utf8NoBom)
  Ok "Patched: $vendorsPage (message forced to ASCII)"
} else {
  Ok "Vendors page: no mojibake message found (no change)."
}

Ok "Vendor menu seed API patch applied."
Write-Host ""
Write-Host "Next: npm run build, then go /admin/vendors and Add item, then test /api/takeout/menu?vendor_id=..." -ForegroundColor Cyan
