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

$apiDir   = Join-Path $ProjRoot "app\api\verify\session-user"
$apiRoute = Join-Path $apiDir "route.ts"
EnsureDir $apiDir

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir
$ts = Stamp

if (Test-Path -LiteralPath $apiRoute) {
  $bak = Join-Path $bakDir ("route.ts.bak.VERIFY_SESSIONUSER_SUPABASE_COOKIES_V1.$ts")
  Copy-Item -LiteralPath $apiRoute -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

# Supabase SSR server client using Next.js cookies()
# Requires: @supabase/ssr installed (common in modern Next+Supabase setups)
# Uses NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (client keys) to validate sb- cookies.
$content = @'
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cookieNames(cookieHeader: string | null) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("=")[0])
    .slice(0, 50);
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, reason: "missing_env", needs: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] },
        { status: 200 }
      );
    }

    const cookieStore = cookies();

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // Route handlers can set cookies; keep for completeness
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user?.id) {
      // Debug: cookie names only (no values)
      const hdr = cookieStore.toString ? cookieStore.toString() : null;
      return NextResponse.json(
        {
          ok: false,
          reason: "no_supabase_user",
          debug: {
            cookieNames: cookieNames(hdr),
            hasSbCookies: cookieNames(hdr).some((n) => n.startsWith("sb-") && n.includes("-auth-token")),
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, user_id: data.user.id }, { status: 200 });
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
Write-Host "[DONE] FIX_VERIFY_SESSIONUSER_USE_SUPABASE_COOKIES_V1 applied."