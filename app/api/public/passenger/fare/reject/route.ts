import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeBaseUrl(v: string): string {
  return String(v || "").trim().replace(/\/+$/, "");
}

function requestOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return normalizeBaseUrl(u.origin);
  } catch {}

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host) return normalizeBaseUrl(`${proto}://${host}`);

  return "";
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const booking_id = body?.booking_id ? String(body.booking_id).trim() : "";
    if (!booking_id) {
      return NextResponse.json({ ok: false, error: "Missing booking_id" }, { status: 400 });
    }

    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("id, booking_code, created_by_user_id")
      .eq("id", booking_id)
      .single();

    if (bErr) {
      return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
    }

    if (!booking) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (String(booking.created_by_user_id || "") !== String(user.id)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const booking_code = String(booking.booking_code || "").trim();
    if (!booking_code) {
      return NextResponse.json({ ok: false, error: "BOOKING_CODE_MISSING" }, { status: 500 });
    }

    const baseUrl = normalizeBaseUrl(
      envAny([
        "INTERNAL_BASE_URL",
        "NEXTAUTH_URL",
        "NEXT_PUBLIC_BASE_URL",
      ]) || requestOrigin(req)
    );

    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "BASE_URL_MISSING" }, { status: 500 });
    }

    const url = `${baseUrl}/api/rides/fare-response`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        booking_code,
        action: "reject",
      }),
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    return NextResponse.json(json ?? { ok: false, error: "EMPTY_RESPONSE" }, { status: res.status });
  } catch (e: any) {
    console.error("[public/passenger/fare/reject] exception", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}