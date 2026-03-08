import { NextResponse } from "next/server";

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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const booking_code = s(body?.booking_code).trim();
    const booking_id = s(body?.booking_id).trim();

    if (!booking_code && !booking_id) {
      return bad("Provide booking_code or booking_id.", "BAD_REQUEST", 400);
    }

    const origin = new URL(req.url).origin;
    const adminSecret =
      req.headers.get("x-jride-admin-secret") ||
      req.headers.get("x-admin-secret") ||
      "";

    const assignRes = await fetch(origin + "/api/dispatch/assign", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(adminSecret ? { "x-jride-admin-secret": adminSecret } : {}),
      },
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
      return ok({
        ok: true,
        retried: true,
        assign: {
          ok: false,
          code: s(assignJson?.code || `HTTP_${assignRes.status}`),
          message: s(assignJson?.message || assignJson?.error || "Retry completed with no assignment"),
        },
      });
    }

    return ok({
      ok: true,
      retried: true,
      assign: {
        ok: true,
        code: "OK",
        message: s(assignJson?.message || "Assignment completed"),
        booking_code: assignJson?.booking_code ?? null,
        booking_id: assignJson?.booking_id ?? null,
        assigned_driver_id: assignJson?.assigned_driver_id ?? null,
      },
    });
  } catch (e: any) {
    return bad("Unexpected retry-auto-assign error", "RETRY_AUTO_ASSIGN_UNEXPECTED", 500, {
      details: String(e?.message || e),
    });
  }
}