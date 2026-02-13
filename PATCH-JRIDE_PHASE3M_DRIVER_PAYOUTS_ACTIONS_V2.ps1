# PATCH-JRIDE_PHASE3M_DRIVER_PAYOUTS_ACTIONS_V2.ps1
# Fixes PowerShell backtick/template literal corruption by:
# - Using single-quoted here-string @' '@
# - Avoiding TS template literals entirely
# Adds POST actions: approve / reject / mark_paid (idempotent)
# UTF-8 NO BOM output

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root = Find-RepoRoot (Get-Location).Path
$target = Join-Path $root "app\api\admin\driver-payouts\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "[OK] Backup: $bak"

$code = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error("Missing env var: " + name);
  return v;
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}

async function restGetOneById(SUPABASE_URL: string, SERVICE_ROLE: string, id: string) {
  const qs = new URLSearchParams();
  qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");
  qs.set("id", "eq." + id);
  qs.set("limit", "1");

  const url = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let arr: any[] = [];
  try { arr = JSON.parse(text || "[]"); } catch { arr = []; }
  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
  return { ok: true, row };
}

async function restPatchById(
  SUPABASE_URL: string,
  SERVICE_ROLE: string,
  id: string,
  patch: Record<string, any>
) {
  const qs = new URLSearchParams();
  qs.set("id", "eq." + id);
  qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");

  const url = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let out: any[] = [];
  try { out = JSON.parse(text || "[]"); } catch { out = []; }
  return { ok: true, row: Array.isArray(out) && out.length ? out[0] : null };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending").toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const qs = new URLSearchParams();
    qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");
    qs.set("order", "id.desc");
    qs.set("limit", String(limit));
    if (status && status !== "all") qs.set("status", "eq." + status);

    const restUrl = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
    const res = await fetch(restUrl, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: text }, { status: res.status });

    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

type ActionReq = {
  id?: string | number | null;
  action?: "approve" | "reject" | "mark_paid" | string | null;
  payout_method?: string | null;
  payout_ref?: string | null;
  receipt_url?: string | null;
  admin_note?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ActionReq;

    const idRaw = body?.id;
    const action = String(body?.action || "").trim().toLowerCase();

    if (!idRaw) return jsonErr("BAD_REQUEST", "Missing id", 400);
    if (!action) return jsonErr("BAD_REQUEST", "Missing action", 400);

    const id = String(idRaw);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const cur = await restGetOneById(SUPABASE_URL, SERVICE_ROLE, id);
    if (!cur.ok) return jsonErr("DB_ERROR", cur.text || "Failed to load payout request", 500);
    if (!cur.row) return jsonErr("NOT_FOUND", "Payout request not found", 404, { id });

    const currentStatus = String(cur.row.status || "").toLowerCase();

    let targetStatus: string | null = null;
    if (action === "approve") targetStatus = "approved";
    else if (action === "reject") targetStatus = "rejected";
    else if (action === "mark_paid") targetStatus = "paid";
    else return jsonErr("BAD_REQUEST", "Invalid action (approve|reject|mark_paid)", 400, { action });

    if (currentStatus === targetStatus) {
      return jsonOk({ ok: true, changed: false, idempotent: true, id, status: currentStatus, row: cur.row });
    }

    if ((targetStatus === "approved" || targetStatus === "rejected") && currentStatus !== "pending") {
      return jsonErr(
        "INVALID_STATE",
        "Cannot " + targetStatus + " when status is " + currentStatus,
        409,
        { id, current_status: currentStatus, target_status: targetStatus }
      );
    }

    if (targetStatus === "paid" && !(currentStatus === "approved" || currentStatus === "pending")) {
      return jsonErr(
        "INVALID_STATE",
        "Cannot mark_paid when status is " + currentStatus,
        409,
        { id, current_status: currentStatus, target_status: targetStatus }
      );
    }

    const patch: any = {
      status: targetStatus,
      processed_at: new Date().toISOString(),
    };

    if (body.payout_method != null) patch.payout_method = body.payout_method;
    if (body.payout_ref != null) patch.payout_ref = body.payout_ref;
    if (body.receipt_url != null) patch.receipt_url = body.receipt_url;
    if (body.admin_note != null) patch.admin_note = body.admin_note;

    const upd = await restPatchById(SUPABASE_URL, SERVICE_ROLE, id, patch);
    if (!upd.ok) return jsonErr("DB_ERROR", upd.text || "Failed to update payout request", 500);

    return jsonOk({ ok: true, changed: true, id, status: targetStatus, row: upd.row });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || String(e), 500);
  }
}
'@

# Write UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
