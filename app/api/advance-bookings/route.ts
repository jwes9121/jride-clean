import { NextRequest, NextResponse } from "next/server";
import { createAdvanceBooking } from "@/lib/advance-booking/create";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createAdvanceBooking(body);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
          existingBooking: result.existingBooking ?? null,
        },
        {
          status: result.status ?? 400,
        }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[advance-booking:create]", err);

    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
      },
      {
        status: 500,
      }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status");
    const passengerId = searchParams.get("passengerId");

    let query = supabaseAdmin()
      .from("advance_bookings")
      .select("*")
      .order("scheduled_pickup_at", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    }

    if (passengerId) {
      query = query.eq("passenger_id", passengerId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
    });
  } catch (err) {
    console.error("[advance-booking:list]", err);

    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
      },
      {
        status: 500,
      }
    );
  }
}