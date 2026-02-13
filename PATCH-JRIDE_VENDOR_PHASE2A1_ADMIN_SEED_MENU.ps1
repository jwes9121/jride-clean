# PATCH-JRIDE_VENDOR_PHASE2A1_ADMIN_SEED_MENU.ps1
# Adds Admin seed tool for vendor_menu_items (create only)
# - Creates: app/api/admin/vendor-menu-items/route.ts
# - Edits:   app/admin/vendors/page.tsx
# UTF-8 no BOM, backups included.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$adminVendorsPage = Join-Path $root "app\admin\vendors\page.tsx"
if (!(Test-Path $adminVendorsPage)) { Fail "Missing file: $adminVendorsPage" }

function Backup($p){
  $bak = "$p.bak.$ts"
  Copy-Item -Force $p $bak
  Ok "Backup: $bak"
}

Backup $adminVendorsPage

# Ensure API dir
$apiDir = Join-Path $root "app\api\admin\vendor-menu-items"
if (!(Test-Path $apiDir)) {
  New-Item -ItemType Directory -Force -Path $apiDir | Out-Null
  Ok "Created dir: $apiDir"
}

$apiFile = Join-Path $apiDir "route.ts"

# ---- Write API: app/api/admin/vendor-menu-items/route.ts ----
# Admin-only helper (still using service role). No deletes.
$api = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getServiceRoleAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toNum(v: any): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// GET /api/admin/vendor-menu-items?vendor_id=UUID
export async function GET(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const vendor_id = String(req.nextUrl.searchParams.get("vendor_id") || "").trim();
  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });

  const { data, error } = await admin
    .from("vendor_menu_items")
    .select("id,vendor_id,name,description,price,sort_order,is_active,created_at,updated_at")
    .eq("vendor_id", vendor_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, vendor_id, items: Array.isArray(data) ? data : [] });
}

// POST /api/admin/vendor-menu-items
// body: { vendor_id, name, price, description?, sort_order? }
export async function POST(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));

  const vendor_id = String(body.vendor_id || body.vendorId || "").trim();
  const name = String(body.name || "").trim();
  const description = (body.description === null || body.description === undefined) ? null : String(body.description).trim();
  const price = toNum(body.price);
  const sort_order = body.sort_order === undefined || body.sort_order === null ? 0 : Number(body.sort_order);

  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  if (!name) return json(400, { ok: false, error: "name_required", message: "name required" });
  if (price === null) return json(400, { ok: false, error: "bad_price", message: "price must be a number" });
  if (!isFinite(sort_order)) return json(400, { ok: false, error: "bad_sort_order", message: "sort_order must be a number" });

  const insertRow: any = {
    vendor_id,
    name,
    description: description || null,
    price,
    sort_order: sort_order,
    is_active: true,
  };

  const { data, error } = await admin
    .from("vendor_menu_items")
    .insert(insertRow)
    .select("id,vendor_id,name,description,price,sort_order,is_active,created_at,updated_at")
    .single();

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, item: data });
}
'@

[System.IO.File]::WriteAllText($apiFile, $api, $utf8NoBom)
Ok "Wrote: $apiFile"

# ---- Edit Admin Vendors page: add seed UI ----
$txt = Get-Content -Raw -Encoding UTF8 $adminVendorsPage

# Hard fail if it doesn't look like the expected file
if ($txt -notmatch "function\s+qrUrl" -or $txt -notmatch "Copy a vendor's private link") {
  Fail "app/admin/vendors/page.tsx does not match expected VendorsPage structure. Paste first 120 lines."
}

# Insert state + helpers after copied state
if ($txt -notmatch "const\s+\[copied,\s*setCopied\]" ) {
  Fail "Anchor not found: copied state"
}

# Add new states if not present
if ($txt -notmatch "seedName") {
  $txt = $txt -replace '(const\s+\[copied,\s*setCopied\]\s*=\s*React\.useState<[^>]*>\([^)]*\);\s*)',
@'
$1

  // PHASE2A1_ADMIN_SEED_MENU
  const [seedName, setSeedName] = React.useState<Record<string, string>>({});
  const [seedPrice, setSeedPrice] = React.useState<Record<string, string>>({});
  const [seedDesc, setSeedDesc] = React.useState<Record<string, string>>({});
  const [seedBusy, setSeedBusy] = React.useState<string | null>(null);
  const [seedMsg, setSeedMsg] = React.useState<Record<string, string>>({});

  async function seedMenuItem(vendorId: string) {
    const name = String(seedName[vendorId] || "").trim();
    const price = String(seedPrice[vendorId] || "").trim();
    const description = String(seedDesc[vendorId] || "").trim();

    if (!name) {
      setSeedMsg((m) => ({ ...m, [vendorId]: "Name required" }));
      return;
    }
    if (!price || isNaN(Number(price))) {
      setSeedMsg((m) => ({ ...m, [vendorId]: "Price must be a number" }));
      return;
    }

    setSeedBusy(vendorId);
    setSeedMsg((m) => ({ ...m, [vendorId]: "" }));

    try {
      const res = await fetch("/api/admin/vendor-menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_id: vendorId,
          name,
          price: Number(price),
          description: description || null,
          sort_order: 0,
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to seed menu item");
      }

      setSeedMsg((m) => ({ ...m, [vendorId]: "Added ✓" }));
      setSeedName((s) => ({ ...s, [vendorId]: "" }));
      setSeedPrice((s) => ({ ...s, [vendorId]: "" }));
      setSeedDesc((s) => ({ ...s, [vendorId]: "" }));

      setTimeout(() => setSeedMsg((m) => ({ ...m, [vendorId]: "" })), 1500);
    } catch (e: any) {
      setSeedMsg((m) => ({ ...m, [vendorId]: String(e?.message || e || "Failed") }));
    } finally {
      setSeedBusy(null);
    }
  }
'@
}

# Inject UI block inside each vendor row under the QR block (simple + non-invasive)
if ($txt -notmatch "PHASE2A1_ADMIN_SEED_MENU_UI") {
  $txt = $txt -replace '(</div>\s*<div className="mt-1 break-all font-mono text-\[11px\] opacity-70">\{link\}</div>\s*</td>\s*</tr>)',
@'
</div>
                        <div className="mt-1 break-all font-mono text-[11px] opacity-70">{link}</div>

                        {/* PHASE2A1_ADMIN_SEED_MENU_UI */}
                        <div className="mt-3 rounded-lg border border-black/10 bg-slate-50 p-2">
                          <div className="text-[11px] font-medium opacity-80">Seed menu item (admin)</div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                            <input
                              value={seedName[v.id] || ""}
                              onChange={(e) => setSeedName((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Item name"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <input
                              value={seedPrice[v.id] || ""}
                              onChange={(e) => setSeedPrice((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Price"
                              inputMode="decimal"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <input
                              value={seedDesc[v.id] || ""}
                              onChange={(e) => setSeedDesc((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Description (optional)"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={seedBusy === v.id}
                              onClick={() => seedMenuItem(v.id)}
                              className="rounded border border-black/10 bg-white px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-60"
                            >
                              {seedBusy === v.id ? "Adding..." : "Add item"}
                            </button>
                          </div>
                          {seedMsg[v.id] ? (
                            <div className="mt-2 text-[11px] opacity-80">{seedMsg[v.id]}</div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
'@
}

# Write back
[System.IO.File]::WriteAllText($adminVendorsPage, $txt, $utf8NoBom)
Ok "Patched: $adminVendorsPage"

Ok "Phase 2A.1 Admin seed tool applied."
Write-Host ""
Write-Host "Next: npm run build, then test Admin Vendors page -> seed item -> Vendor Menu tab should show it." -ForegroundColor Cyan
