import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function POST(
  request: Request,
  context: { params: { bookingCode: string } }
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const bookingCode = context.params.bookingCode;
    const body = await request.json().catch(() => ({}));
    const rating = Number(body.rating ?? 0);
    const comment = (body.comment ?? "").toString().slice(0, 1000);

    if (!bookingCode) {
      return NextResponse.json(
        { error: "Missing booking code" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("order_ratings").insert({
      booking_code: bookingCode,
      rating,
      comment,
    });

    if (error) {
      console.error("❌ Error inserting rating:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("❌ Rating API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
