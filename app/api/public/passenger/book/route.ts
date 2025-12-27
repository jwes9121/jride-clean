import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type BookReq = {
  passenger_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  service?: string | null;
};

function codeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

function rand4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

  const booking_code = `JR-UI-${codeNow()}-${rand4()}`;

  const payload: any = {
    booking_code,
    passenger_name: body.passenger_name ?? null,
    from_label: body.from_label ?? null,
    to_label: body.to_label ?? null,
    town: body.town ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[passenger/book] insert error", error);
    return NextResponse.json(
      { ok: false, code: "BOOKING_INSERT_FAILED", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, booking_code, booking: data ?? null },
    { status: 200 }
  );
}