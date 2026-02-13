import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  booking_id?: string | null;

  bookingCode?: string | null;
  booking_code?: string | null;

  status?: string | null;
  nextStatus?: string | null;

  override?: boolean | null;
  source?: string | null;
};

const ALLOWED = new Set([
  "pending",
  "assigned",
  "on_the_way",
  "on_trip",
  "completed",
  "cancelled",
]);

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function pickBodyId(b: Body) {
  const bookingId = String(b.bookingId ?? b.booking_id ?? "").trim();
  const bookingCode = String(b.bookingCode ?? b.booking_code ?? "").trim();
  return { bookingId, bookingCode };
}

function canTransition(fromS: string, toS: string, override: boolean) {
  if (override) return true;
  if (!fromS) return true;

  const from = norm(fromS);
  const to = norm(toS);

  if (from === to) return true;

  if (from === "assigned" && to === "on_the_way") return true;
  if (from === "on_the_way" && to === "on_trip") return true;
  if (from === "on_trip" && to === "completed") return true;

  if (to === "cancelled" && from !== "completed" && from !== "cancelled") return true;
  if (from === "pending" && to === "assigned") return true;

  return false;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const { bookingId, bookingCode } = pickBodyId(body);
    const override = !!body.override;
    const source = String(body.source ?? "admin").trim();

    const toStatus = norm(body.status ?? body.nextStatus);
    if (!toStatus) {
      return NextResponse.json({ error: "MISSING_STATUS" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!ALLOWED.has(toStatus)) {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: Status '' not allowed. },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    let readQ = supabase.from("bookings").select("id, booking_code, status, driver_id, updated_at, created_at").limit(1);
    if (bookingId) readQ = readQ.eq("id", bookingId);
    else readQ = readQ.eq("booking_code", bookingCode);

    const { data: curRows, error: curErr } = await readQ;
    if (curErr) {
      console.error("DISPATCH_STATUS_READ_ERROR", curErr);
      return NextResponse.json(
        { error: "DISPATCH_STATUS_READ_ERROR", message: curErr.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const cur = (curRows ?? [])[0] as any;
    if (!cur?.id) {
      return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const fromStatus = String(cur.status ?? "").trim();
    if (!canTransition(fromStatus, toStatus, override)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: Cannot change status from '' to ''. },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const nowIso = new Date().toISOString();

    const updatePayload: any = {
      status: toStatus,
      updated_at: nowIso,
    };

    const { data: updRows, error: updErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", String(cur.id))
      .select("id, booking_code, status, driver_id, updated_at")
      .limit(1);

    if (updErr) {
      console.error("DISPATCH_STATUS_DB_ERROR", updErr);
      return NextResponse.json(
        { error: "DISPATCH_STATUS_DB_ERROR", message: updErr.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const upd = (updRows ?? [])[0] as any;

    return NextResponse.json(
      {
        ok: true,
        bookingId: String(upd?.id ?? cur.id),
        bookingCode: String(upd?.booking_code ?? cur.booking_code ?? bookingCode ?? ""),
        fromStatus: fromStatus || null,
        toStatus,
        updatedAt: String(upd?.updated_at ?? nowIso),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("DISPATCH_STATUS_UNEXPECTED", err);
    return NextResponse.json(
      { error: "DISPATCH_STATUS_UNEXPECTED", message: err?.message ?? "Unexpected error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
