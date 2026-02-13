# PATCH-JRIDE_VERIFICATION_USE_NEXTAUTH_V1.ps1
# Switch passenger verification API from Supabase auth to NextAuth session
# ASCII only

$ErrorActionPreference = "Stop"

function NowStamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p) { [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp

$api = Join-Path $root "app\api\public\passenger\verification\request\route.ts"
if(!(Test-Path $api)){ throw "Missing $api" }

Copy-Item $api "$api.bak.$stamp" -Force
Write-Host "[OK] Backup created"

$txt = ReadU $api

$txt = @'
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = session.user.id;
  const supabase = createClient();

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    authed: true,
    passenger_id,
    request: (!r.error && r.data) ? r.data : null
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const passenger_id = session.user.id;
  const body: any = await req.json().catch(() => ({}));
  const full_name = String(body.full_name || "").trim();
  const town = String(body.town || "").trim();

  if (!full_name) {
    return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
  }
  if (!town) {
    return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
  }

  const supabase = createClient();

  const up = await supabase
    .from("passenger_verification_requests")
    .upsert({
      passenger_id,
      full_name,
      town,
      status: "pending",
      submitted_at: new Date().toISOString()
    }, { onConflict: "passenger_id" })
    .select("*")
    .single();

  if (up.error) {
    return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, request: up.data });
}
'@

WriteU $api $txt
Write-Host "[OK] Verification API now uses NextAuth session"
