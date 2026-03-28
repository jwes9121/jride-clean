import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    if (action === "accept") {
      return fetch(`${process.env.NEXTAUTH_URL}/api/public/passenger/fare/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()).then(data => NextResponse.json(data));
    }

    if (action === "reject") {
      return fetch(`${process.env.NEXTAUTH_URL}/api/public/passenger/fare/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()).then(data => NextResponse.json(data));
    }

    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION" },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: e.message },
      { status: 500 }
    );
  }
}