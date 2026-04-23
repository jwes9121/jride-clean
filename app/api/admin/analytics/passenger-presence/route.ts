import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeTown(v: unknown): string {
  const s = text(v);
  return s || "Unknown";
}

function isFresh(lastSeenAt: string | null | undefined, maxAgeSeconds: number): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= maxAgeSeconds * 1000;
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    const url = new URL(req.url);
    const freshnessSecondsRaw = Number(url.searchParams.get("freshness_seconds") || "90");
    const freshnessSeconds =
      Number.isFinite(freshnessSecondsRaw) && freshnessSecondsRaw > 0
        ? Math.min(Math.max(freshnessSecondsRaw, 30), 600)
        : 90;

    const townScope = text(url.searchParams.get("town"));

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("passenger_app_presence")
      .select("passenger_id, passenger_name, town, app_state, screen_name, last_seen_at, last_booking_code, platform")
      .order("last_seen_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "PASSENGER_PRESENCE_READ_FAILED", message: error.message },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const filtered = rows.filter((row: any) => {
      if (!isFresh(row?.last_seen_at, freshnessSeconds)) return false;
      if (!townScope) return true;
      return normalizeTown(row?.town).toLowerCase() === townScope.toLowerCase();
    });

    const presenceRows = filtered.map((row: any) => ({
      passenger_id: text(row?.passenger_id),
      passenger_name: text(row?.passenger_name) || "Unknown Passenger",
      town: normalizeTown(row?.town),
      app_state: text(row?.app_state) || "foreground",
      screen_name: text(row?.screen_name) || "-",
      last_seen_at: row?.last_seen_at || null,
      last_booking_code: text(row?.last_booking_code) || null,
      platform: text(row?.platform) || "-",
      is_active_now: true,
    }));

    const counts = {
      active_now: presenceRows.length,
      foreground_now: presenceRows.filter((r) => r.app_state === "foreground").length,
      background_now: presenceRows.filter((r) => r.app_state === "background").length,
      offline_marked_now: presenceRows.filter((r) => r.app_state === "offline").length,
      with_booking_now: presenceRows.filter((r) => !!r.last_booking_code).length,
      searching_now: presenceRows.filter(
        (r) =>
          !r.last_booking_code &&
          ["passengerbookrideactivity", "passengersearchingactivity", "search", "booking", "home"].includes(
            (r.screen_name || "").toLowerCase()
          )
      ).length,
    };

    const byTown: Record<string, number> = {};
    for (const row of presenceRows) {
      byTown[row.town] = Number(byTown[row.town] || 0) + 1;
    }

    const towns = Object.entries(byTown)
      .map(([town, active_now]) => ({ town, active_now }))
      .sort((a, b) => b.active_now - a.active_now || a.town.localeCompare(b.town, "en"));

    return NextResponse.json({
      ok: true,
      freshness_seconds: freshnessSeconds,
      counts,
      towns,
      rows: presenceRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "PASSENGER_PRESENCE_ANALYTICS_FAILED", message: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
