import { NextResponse } from "next/server";

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text().catch(() => "{}");

    const baseUrl =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://app.jride.net";

    const targetUrl = baseUrl.replace(/\/+$/, "") + "/api/driver/fare/propose";

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
        ...(req.headers.get("x-jride-driver-secret")
          ? { "x-jride-driver-secret": req.headers.get("x-jride-driver-secret") as string }
          : {}),
      },
      body: bodyText,
      cache: "no-store",
    });

    const data = await upstream.json().catch(() => ({}));

    return NextResponse.json(data, {
      status: upstream.status,
      headers: noStoreHeaders(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "DRIVER_FARE_OFFER_FORWARD_FAILED",
        message: String(err?.message ?? err),
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }
}