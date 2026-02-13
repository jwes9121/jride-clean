# PATCH-JRIDE_11C_ADMIN_VERIFY_API_AND_UI_V1.ps1
# ASCII-only. UTF8 NO BOM. Anchor-based. UI/admin-only verification wiring.
# Creates:
#   app/api/admin/passenger-verifications/approve/route.ts
#   app/api/admin/passenger-verifications/reject/route.ts
# Patches the admin verification page to use these endpoints.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }

function WriteUtf8NoBom($path, $text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path -Parent $path
  if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

function ReadText($path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path)
}

$root = (Get-Location).Path

# --- 1) Create API routes ---
$approvePath = Join-Path $root "app\api\admin\passenger-verifications\approve\route.ts"
$rejectPath  = Join-Path $root "app\api\admin\passenger-verifications\reject\route.ts"

$approveCode = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    // Require authenticated user (admin UI should already be gated)
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;
    const user_id = body?.user_id ? String(body.user_id) : null;

    if (!id && !user_id) {
      return NextResponse.json({ ok: false, error: "Missing id or user_id" }, { status: 400 });
    }

    // Minimal, schema-safe update
    let q = supabase.from("passenger_verifications").update({ status: "approved_admin" }).select("*");
    q = id ? q.eq("id", id) : q.eq("user_id", user_id as string);

    const { data, error } = await q;
    if (error) {
      console.error("[approve] error", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: Array.isArray(data) ? data[0] : data }, { status: 200 });
  } catch (e: any) {
    console.error("[approve] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@

$rejectCode = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    // Require authenticated user (admin UI should already be gated)
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;
    const user_id = body?.user_id ? String(body.user_id) : null;
    const reject_reason = body?.reject_reason != null ? String(body.reject_reason) : "";

    if (!id && !user_id) {
      return NextResponse.json({ ok: false, error: "Missing id or user_id" }, { status: 400 });
    }

    // Minimal, schema-safe update
    // NOTE: we only set reject_reason if the column exists; if it doesn't, Supabase will error and we surface it.
    let q = supabase
      .from("passenger_verifications")
      .update({ status: "rejected", reject_reason })
      .select("*");
    q = id ? q.eq("id", id) : q.eq("user_id", user_id as string);

    const { data, error } = await q;
    if (error) {
      console.error("[reject] error", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: Array.isArray(data) ? data[0] : data }, { status: 200 });
  } catch (e: any) {
    console.error("[reject] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@

WriteUtf8NoBom $approvePath $approveCode
WriteUtf8NoBom $rejectPath  $rejectCode
Write-Host "[OK] Wrote API route: $approvePath"
Write-Host "[OK] Wrote API route: $rejectPath"

# --- 2) Find admin verification page automatically ---
# We look for likely admin verification pages that reference passenger_verifications.
$adminCandidates = Get-ChildItem -Path (Join-Path $root "app") -Recurse -File -Include "page.tsx","page.jsx","page.ts" |
  Where-Object {
    try {
      $t = [System.IO.File]::ReadAllText($_.FullName)
      ($t -match 'passenger_verifications') -and ($t -match 'admin') -and ($t -match 'approve|approved_admin|reject|rejected')
    } catch { $false }
  } |
  Select-Object -First 5

if (!$adminCandidates -or $adminCandidates.Count -eq 0) {
  Write-Host "[WARN] Could not auto-locate admin verification page. API routes created successfully."
  Write-Host "       If your admin page is at app/admin/verification/page.tsx, we can patch it next."
  exit 0
}

$adminPath = $adminCandidates[0].FullName
$bak = $adminPath + ".bak." + (Timestamp)
Copy-Item -Force $adminPath $bak
Write-Host "[OK] Admin page found: $adminPath"
Write-Host "[OK] Backup: $bak"

$txt = ReadText $adminPath
$orig = $txt

# --- 3) Patch approve/reject handlers ---
# Replace direct supabase updates with fetch() to our new endpoints.
# Approve: status approved_admin
$txt = [regex]::Replace(
  $txt,
  '(?s)supabase\.from\(\s*["'']passenger_verifications["'']\s*\)\.update\(\s*\{\s*status\s*:\s*["'']approved_admin["'']\s*\}\s*\)(?:\.eq\([^;]*\))?(?:\.select\([^;]*\))?;',
  @'
await fetch("/api/admin/passenger-verifications/approve", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: String(row?.id ?? ""), user_id: row?.user_id ?? null })
});
'@,
  10
)

# Reject: status rejected + reject_reason
$txt = [regex]::Replace(
  $txt,
  '(?s)supabase\.from\(\s*["'']passenger_verifications["'']\s*\)\.update\(\s*\{\s*status\s*:\s*["'']rejected["'']\s*,\s*reject_reason\s*:\s*[^}]+\}\s*\)(?:\.eq\([^;]*\))?(?:\.select\([^;]*\))?;',
  @'
await fetch("/api/admin/passenger-verifications/reject", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: String(row?.id ?? ""), user_id: row?.user_id ?? null, reject_reason: String(rejectReason || "") })
});
'@,
  10
)

# If nothing changed, we still keep API routes; but tell user.
if ($txt -eq $orig) {
  Write-Host "[WARN] Admin page patch did not match exact supabase.update patterns."
  Write-Host "       API routes are created. If admin UI still updates directly, paste the approve/reject handler blocks and I will patch precisely."
  exit 0
}

WriteUtf8NoBom $adminPath $txt
Write-Host "[OK] Patched admin verification page to call new API routes."
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
