import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function takeoutEnabled(): boolean {
  const raw = String(process.env.TAKEOUT_ENABLED || "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function disabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      enabled: false,
      error: "TAKEOUT_DISABLED",
      code: "TAKEOUT_DISABLED",
      message: "Takeout is not enabled yet.",
    },
    { status: 503 }
  );
}

function buildCanonicalUrl(req: NextRequest): URL {
  const url = new URL(req.url);
  url.pathname = "/api/takeout/orders";
  return url;
}

async function forwardToCanonicalOrders(req: NextRequest, method: "GET" | "POST", body?: any) {
  const url = buildCanonicalUrl(req);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;

  const forwarded = await fetch(url.toString(), {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
  });

  const payload = await forwarded.text();
  return new NextResponse(payload, {
    status: forwarded.status,
    headers: {
      "content-type": forwarded.headers.get("content-type") || "application/json",
    },
  });
}

export async function GET(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    return await forwardToCanonicalOrders(req, "GET");
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDERS_LIST_GET_FAILED",
        message: error?.message || "Failed to load takeout orders list.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    const body = await req.json().catch(() => ({}));
    return await forwardToCanonicalOrders(req, "POST", body);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDERS_LIST_POST_FAILED",
        message: error?.message || "Failed to submit takeout orders list request.",
      },
      { status: 500 }
    );
  }
}
