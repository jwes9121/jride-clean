import { NextRequest, NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const forwarded = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(body),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "DISPATCH_FARE_OFFER_FORWARD_FAILED",
      },
      { status: 500 }
    );
  }
}