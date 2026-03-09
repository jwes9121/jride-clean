param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: retry auto-assign auth bridge (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[WARN] Missing file for backup: $Path"
    return
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$routePath = Join-Path $ProjRoot "app\api\dispatch\retry-auto-assign\route.ts"
Backup-File -Path $routePath -Tag "RETRY_AUTOASSIGN_AUTH_BRIDGE_V1"

$routeContent = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function s(v: any): string {
  return String(v ?? "");
}

function firstNonEmpty(values: Array<any>): string {
  for (const v of values) {
    const x = s(v).trim();
    if (x) return x;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const booking_code = s(body?.booking_code).trim();
    const booking_id = s(body?.booking_id).trim();

    if (!booking_code && !booking_id) {
      return bad("Provide booking_code or booking_id.", "BAD_REQUEST", 400);
    }

    const origin = new URL(req.url).origin;
    const cookieHeader = s(req.headers.get("cookie")).trim();

    const internalAdminSecret = firstNonEmpty([
      process.env.JRIDE_ADMIN_SECRET,
      process.env.ADMIN_SECRET,
      process.env.JRIDE_DISPATCH_ADMIN_SECRET,
      process.env.DISPATCH_ADMIN_SECRET,
      process.env.LIVETRIPS_ADMIN_SECRET,
    ]);

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (cookieHeader) {
      headers["cookie"] = cookieHeader;
    }

    if (internalAdminSecret) {
      headers["x-jride-admin-secret"] = internalAdminSecret;
      headers["x-admin-secret"] = internalAdminSecret;
    }

    const assignRes = await fetch(origin + "/api/dispatch/assign", {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        booking_code: booking_code || undefined,
        booking_id: booking_id || undefined,
      }),
    });

    const assignJson: any = await assignRes.json().catch(async () => {
      const txt = await assignRes.text().catch(() => "");
      return {
        ok: false,
        code: "ASSIGN_NON_JSON",
        message: txt || `HTTP ${assignRes.status}`,
      };
    });

    if (!assignRes.ok || assignJson?.ok === false) {
      const message = s(assignJson?.message || assignJson?.error || "");
      const code = s(assignJson?.code || `HTTP_${assignRes.status}`);

      if (
        !internalAdminSecret &&
        (
          code.toUpperCase().includes("UNAUTHORIZED") ||
          message.toLowerCase().includes("not authenticated") ||
          message.toLowerCase().includes("admin secret")
        )
      ) {
        return bad(
          "Retry auto-assign could not authenticate. Set one internal admin secret env on the server route path.",
          "RETRY_AUTO_ASSIGN_AUTH_MISSING",
          500,
          {
            has_cookie_header: Boolean(cookieHeader),
            expected_env_candidates: [
              "JRIDE_ADMIN_SECRET",
              "ADMIN_SECRET",
              "JRIDE_DISPATCH_ADMIN_SECRET",
              "DISPATCH_ADMIN_SECRET",
              "LIVETRIPS_ADMIN_SECRET",
            ],
            assign_error_code: code,
            assign_error_message: message,
          }
        );
      }

      return ok({
        ok: true,
        retried: true,
        assign: {
          ok: false,
          code,
          message: message || "Retry completed with no assignment",
        },
      });
    }

    return ok({
      ok: true,
      retried: true,
      assign: {
        ok: true,
        code: s(assignJson?.code || "OK"),
        message: s(assignJson?.message || "Assignment completed"),
        booking_code: assignJson?.booking_code ?? booking_code ?? null,
        booking_id: assignJson?.booking_id ?? booking_id ?? null,
        assigned_driver_id:
          assignJson?.assigned_driver_id ??
          assignJson?.driver_id ??
          assignJson?.assigned_driver?.id ??
          null,
      },
    });
  } catch (e: any) {
    return bad(
      "Unexpected retry-auto-assign error",
      "RETRY_AUTO_ASSIGN_UNEXPECTED",
      500,
      { details: String(e?.message || e) }
    );
  }
}
'@

Write-TextUtf8NoBom -Path $routePath -Content $routeContent
Write-Host "[OK] Replaced: app/api/dispatch/retry-auto-assign/route.ts"
Write-Host "[DONE] Patch applied."