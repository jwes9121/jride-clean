param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir([string]$p){ if(!(Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
function WriteUtf8NoBom([string]$Path,[string]$Content){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path,$Content,$utf8NoBom)
}

$apiDir = Join-Path $ProjRoot "app\api\verify\session-user"
$apiRoute = Join-Path $apiDir "route.ts"
EnsureDir $apiDir

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir
$ts = Stamp
if (Test-Path -LiteralPath $apiRoute) {
  $bak = Join-Path $bakDir ("route.ts.bak.VERIFY_SESSIONUSER_NO_AUTH_IMPORT_V1.$ts")
  Copy-Item -LiteralPath $apiRoute -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$content = @'
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reads NextAuth session via its built-in endpoint, using the incoming cookies.
// No import from auth.ts required.
export async function GET(req: NextRequest) {
  try {
    // Build absolute URL to /api/auth/session
    const url = new URL("/api/auth/session", req.url);

    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        // forward cookies so NextAuth can read the session
        cookie: req.headers.get("cookie") || "",
      },
      cache: "no-store",
    });

    const session = await r.json().catch(() => null);
    const email = session?.user?.email || null;

    if (!email) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_session_email",
          debug: {
            sessionKeys: session ? Object.keys(session) : [],
            userKeys: session?.user ? Object.keys(session.user) : [],
          },
        },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        {
          ok: false,
          reason: "missing_env",
          needs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
        },
        { status: 200 }
      );
    }

    // Supabase Admin API: list users, then match email
    const adminUrl = `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`;
    const ar = await fetch(adminUrl, {
      method: "GET",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!ar.ok) {
      const t = await ar.text();
      return NextResponse.json(
        { ok: false, reason: "admin_api_error", status: ar.status, body: t },
        { status: 200 }
      );
    }

    const users = await ar.json();
    const arr = Array.isArray(users) ? users : (users?.users || []);
    const u = Array.isArray(arr)
      ? arr.find((x: any) => (x?.email || "").toLowerCase() === email.toLowerCase())
      : null;

    if (!u?.id) {
      return NextResponse.json(
        { ok: false, reason: "no_supabase_user_for_email", email },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, email, supabase_user_id: u.id },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", message: String(e?.message || e) },
      { status: 200 }
    );
  }
}
'@

WriteUtf8NoBom $apiRoute $content
Write-Host "[OK] Wrote: app/api/verify/session-user/route.ts"
Write-Host "[DONE] FIX_VERIFY_SESSIONUSER_NO_AUTH_IMPORT_V1 applied."