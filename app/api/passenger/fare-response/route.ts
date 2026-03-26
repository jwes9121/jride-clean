import { NextResponse } from "next/server";

function text(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ACCEPT MULTIPLE FIELD NAMES (ANDROID + WEB SAFE)
    const action =
      text(body.action) ||
      text(body.response) ||
      text(body.fare_response);

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_ACTION",
          received: body,
        },
        { status: 400 }
      );
    }

    const target =
      action === "accept"
        ? "/api/public/passenger/fare/accept"
        : "/api/public/passenger/fare/reject";

    // IMPORTANT: forward cookies for auth
    const cookie = req.headers.get("cookie") || "";

    const res = await fetch(`${process.env.NEXTAUTH_URL}${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}