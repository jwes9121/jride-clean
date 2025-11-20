import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[assign-nearest/latest] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars"
  );
}

// GET = health check / hint only
export async function GET() {
  return NextResponse.json(
    { ok: true, hint: "POST to assign latest pending ride" },
    { status: 200 }
  );
}

// POST = actually call Supabase RPC to assign the nearest driver
export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json(
        {
          error: "ENV_MISSING",
          message: "SUPABASE_URL or SUPABASE_ANON_KEY not set on server",
        },
        { status: 500 }
      );
    }

    const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/assign_nearest_driver_v2`;

    const supabaseResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      // If your function takes arguments, put them here.
      // Right now we assume it takes no parameters.
      body: JSON.stringify({}),
      cache: "no-store",
    });

    const rawText = await supabaseResponse.text();
    let json: any = null;

    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      // not JSON, keep raw text
    }

    if (!supabaseResponse.ok) {
      console.error("[assign-nearest/latest] Supabase error:", rawText);

      return NextResponse.json(
        {
          error: "DB_ERROR_ASSIGN",
          status: supabaseResponse.status,
          message: json?.message ?? rawText ?? "Unknown Supabase error",
        },
        { status: 500 }
      );
    }

    // Success – forward Supabase result
    return NextResponse.json(
      {
        ok: true,
        result: json,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[assign-nearest/latest] SERVER ERROR:", error);
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: error?.message ?? "Unknown server error",
      },
      { status: 500 }
    );
  }
}
