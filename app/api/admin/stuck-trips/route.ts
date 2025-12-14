import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbGET(SUPABASE_URL: string, SR: string, path: string) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const showAcknowledged = u.searchParams.get("showAcknowledged") === "1";
    const showSnoozed = u.searchParams.get("showSnoozed") === "1";
    const limit = Math.min(Number(u.searchParams.get("limit") || "50") || 50, 200);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SR = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Base: open logs
    const logs = await sbGET(
      SUPABASE_URL,
      SR,
      `/rest/v1/driver_stuck_alert_log?select=id,driver_id,first_detected_at,last_detected_at,times_detected,resolved_at,acknowledged_at,snooze_until,booking_uuid,booking_code&resolved_at=is.null&order=last_detected_at.desc&limit=${limit}`
    );

    const now = Date.now();

    const filtered = (Array.isArray(logs) ? logs : []).filter((l: any) => {
      if (!showAcknowledged && l.acknowledged_at) return false;

      // hide snoozed rows by default
      if (!showSnoozed && l.snooze_until) {
        const t = new Date(l.snooze_until).getTime();
        if (Number.isFinite(t) && t > now) return false;
      }

      return true;
    });

    const rows: any[] = [];

    for (const l of filtered) {
      let booking: any = null;

      if (l.booking_uuid) {
        const b = await sbGET(
          SUPABASE_URL, SR,
          `/rest/v1/bookings?select=id,booking_code,status,assigned_driver_id,pickup_lat,pickup_lng&limit=1&id=eq.${encodeURIComponent(l.booking_uuid)}`
        );
        booking = b?.[0] ?? null;
      } else if (l.booking_code) {
        const b = await sbGET(
          SUPABASE_URL, SR,
          `/rest/v1/bookings?select=id,booking_code,status,assigned_driver_id,pickup_lat,pickup_lng&limit=1&booking_code=eq.${encodeURIComponent(l.booking_code)}`
        );
        booking = b?.[0] ?? null;
      }

      let lastLoc: any = null;
      if (l.driver_id) {
        const dl = await sbGET(
          SUPABASE_URL, SR,
          `/rest/v1/driver_locations?select=driver_id,updated_at&limit=1&driver_id=eq.${encodeURIComponent(l.driver_id)}&order=updated_at.desc`
        );
        lastLoc = dl?.[0] ?? null;
      }

      rows.push({
        log_id: l.id,
        driver_id: l.driver_id,
        booking_id: booking?.id ?? null,
        booking_code: booking?.booking_code ?? l.booking_code ?? null,
        status: booking?.status ?? null,
        current_driver: booking?.assigned_driver_id ?? null,
        first_detected_at: l.first_detected_at,
        last_detected_at: l.last_detected_at,
        times_detected: l.times_detected,
        acknowledged_at: l.acknowledged_at ?? null,
        snooze_until: l.snooze_until ?? null,
        last_location_at: lastLoc?.updated_at ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      stuck_visible: rows.length,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
