import { NextResponse } from "next/server";

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeBaseUrl(v: string): string {
  return String(v || "").trim().replace(/\/+$/, "");
}

function requestOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return normalizeBaseUrl(u.origin);
  } catch {}

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host) return normalizeBaseUrl(`${proto}://${host}`);

  return "";
}

export async function POST(req: Request) {
  console.log("[DISPATCH_TRACE] retry:start", { at: new Date().toISOString() });

  try {
    const baseUrl = normalizeBaseUrl(
      envAny([
        "INTERNAL_BASE_URL",
        "NEXTAUTH_URL",
        "NEXT_PUBLIC_BASE_URL",
      ]) || requestOrigin(req)
    );

    if (!baseUrl) {
      console.error("[DISPATCH_TRACE] retry:error", {
        message: "BASE_URL_MISSING",
      });

      return NextResponse.json(
        { ok: false, error: "BASE_URL_MISSING" },
        { status: 500 }
      );
    }

    const url = `${baseUrl}/api/dispatch/auto-assign`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ mode: "scan_pending" }),
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    console.log("[DISPATCH_TRACE] retry:auto_assign_response", {
      ok: res.ok,
      status: res.status,
      url,
      auto_assign_ok: json?.ok ?? null,
      mode: json?.mode ?? null,
      assigned_count: json?.assigned_count ?? null,
      skipped_count: json?.skipped_count ?? null,
      blocked_count: json?.blocked_count ?? null,
    });

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url,
      result: json,
    });
  } catch (e: any) {
    console.error("[DISPATCH_TRACE] retry:error", {
      message: String(e?.message || e),
    });

    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}