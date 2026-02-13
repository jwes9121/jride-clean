# PATCH-JRIDE_ADMIN_VERIFICATION_PENDING_API_FIX_V1.ps1
# Fix: remove missing "@/utils/supabase/admin" import by creating an admin supabase client inline.
# ASCII only.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp

$target = Join-Path $root "app\api\admin\verification\pending\route.ts"
if(!(Test-Path $target)){ throw "Missing: $target" }

Copy-Item $target "$target.bak.$stamp" -Force
Write-Host "[OK] Backup: $target.bak.$stamp"

$txt = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error("Missing env: " + name);
  return v;
}

function adminSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  try {
    const supabase = adminSupabase();

    const q = await supabase
      .from("passenger_verification_requests")
      .select("*")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (q.error) {
      return NextResponse.json({ ok: false, error: q.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, rows: q.data || [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || "error") },
      { status: 500 }
    );
  }
}
'@

WriteU $target $txt
Write-Host "[OK] Patched: app/api/admin/verification/pending/route.ts"
