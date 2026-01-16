import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const sa = supabaseAdmin();
async function triggerAutoReassign() {
  try {
    const baseUrl =
      process.env.NEXTAUTH_URL ||
      process.env.APP_BASE_URL ||
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : null;

    if (!baseUrl) {
      console.error("AUTO_REASSIGN_SKIP: no base URL env found");
      return;
    }

    const res = await fetch(`${baseUrl}/api/rides/assign-nearest/latest`, {
      method: "GET",
      // no body needed, this endpoint already works via GET in your tests
    });

    if (!res.ok) {
      console.error("AUTO_REASSIGN_HTTP_ERROR", res.status, await res.text());
    }
  } catch (err) {
    console.error("AUTO_REASSIGN_ERROR", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingCode: string | undefined = body?.bookingCode;

    // ===== JRIDE_FARE_RESPONSE_RESOLVE_BOOKING_ID_V1 =====
    // Prevent PostgREST .maybeSingle() coercion errors when bookingCode matches multiple rows.
    // Resolve the most recent booking id for this code, then update by id.
    let bookingId: string | null = null;
    try {
      const q = await sa.from("bookings")
        .select("id, updated_at, created_at")
        .eq("code", bookingCode)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

      if (q.error) {
        return NextResponse.json({ ok: false, error: "DB_ERROR_LOOKUP", details: q.error.message }, { status: 500 });
      }
      const row = (q.data && q.data[0]) ? q.data[0] : null;
      bookingId = row ? String(row.id) : null;
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "LOOKUP_EXCEPTION", details: String(e?.message || e) }, { status: 500 });
    }

    if (!bookingId) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", details: "No booking found for bookingCode" }, { status: 404 });
    }
    // ===== END JRIDE_FARE_RESPONSE_RESOLVE_BOOKING_ID_V1 =====
    const response: "accepted" | "rejected" | undefined = body?.response;

    if (!bookingCode || !response) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    if (response !== "accepted" && response !== "rejected") {
      return NextResponse.json(
        { ok: false, error: "INVALID_RESPONSE" },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      passenger_fare_response: response,
      updated_at: new Date().toISOString(),
    };

    if (response === "accepted") {
      // keep current driver, proceed as normal
      updates.status = "driver_accepted";
    } else {
      // passenger rejected the fare:
      // reset booking and free driver, ready for auto re-assign
      updates.status = "pending";
      updates.assigned_driver_id = null;
      updates.proposed_fare = null;
    }

    const { data, error } = await sa.from("bookings")
      .update(updates)
      .eq("id", bookingId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("FARE_RESPONSE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    if (response === "rejected") {
      // fire-and-forget auto reassign ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ no need to await for response to user
      triggerAutoReassign();
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_RESPONSE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
