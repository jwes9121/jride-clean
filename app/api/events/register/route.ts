import { NextRequest, NextResponse } from "next/server";
import { registerAttendee } from "@/lib/events/registration";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await registerAttendee(supabaseAdmin(), body, {
      source: "online",
    });

    const status = result.success ? 200 : 400;
    return NextResponse.json(result, { status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: error instanceof Error ? error.message : "Registration failed.",
        },
      },
      { status: 500 }
    );
  }
}