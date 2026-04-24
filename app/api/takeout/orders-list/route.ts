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
      code: "TAKEOUT_DISABLED",
      message: "Takeout is not enabled yet.",
    },
    { status: 503 }
  );
}

function buildForwardUrl(req: NextRequest): URL {
  const url = new URL(req.url);
  url.pathname = "/api/takeout/orders";
  return url;
}

export async function GET(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    const url = buildForwardUrl(req);
    return NextResponse.redirect(url, 307);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDERS_LIST_GET_FAILED",
        message: error?.message || "Failed to forward takeout orders list request.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    const body = await req.json().catch(() => ({}));
    const url = buildForwardUrl(req);

    const forwarded = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await forwarded.text();
    return new NextResponse(text, {
      status: forwarded.status,
      headers: {
        "content-type": forwarded.headers.get("content-type") || "application/json",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDERS_LIST_POST_FAILED",
        message: error?.message || "Failed to forward takeout orders list request.",
      },
      { status: 500 }
    );
  }
}