import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;


function fmtPH(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;

  // Format in Asia/Manila (UTC+8). This is for display only.
  return new Date(t).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
// ---------- schema-flex helpers ----------
function str(v: any): string {
  return v == null ? "" : String(v);
}

function toIsoOrNull(v: any): string | null {
  if (v == null) return null;
  const s = str(v).trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function bestUpdatedAt(row: any): string | null {
  if (!row) return null;

  // Prefer real timestamp fields (schema-flex)
  const candidates = [
    row.location_updated_at,
    row.locationUpdatedAt,
    row.updated_at,
    row.updatedAt,
    row.last_location_at,
    row.lastLocationAt,
    row.last_seen_at,
    row.lastSeenAt,
    row.seen_at,
    row.seenAt,
    row.pinged_at,
    row.pingedAt,
    row.ts,
    row.timestamp,
    row.created_at,
    row.createdAt,
  ];

  for (const c of candidates) {
    const iso = toIsoOrNull(c);
    if (iso) return iso;
  }
  return null;
}

function newest(aIso: string | null, bIso: string | null): string | null {
  if (!aIso) return bIso;
  if (!bIso) return aIso;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a)) return bIso;
  if (!Number.isFinite(b)) return aIso;
  return b > a ? bIso : aIso;
}

function bestStatus(row: any): string | null {
  if (!row) return null;
  const candidates = [row.status, row.state, row.availability, row.driver_status, row.driverStatus, row.live_status, row.online_status];
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }
  return null;
}

function bestDriverId(row: any): string | null {
  if (!row) return null;

  // Prefer explicit driver id fields (schema-flex)
  const candidates = [
    row.driver_id,
    row.driverId,
    row.driver_uuid,
    row.driverUuid,
    row.uuid,
    row.id,
    row.user_id,
    row.userId,
  ];

  // First pass: return first UUID-looking value
  for (const c of candidates) {
    const s = str(c).trim();
    if (!s) continue;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
      return s;
    }
  }

  // Fallback: any non-empty string
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }

  return null;
}
async function trySources(
  supabase: any,
  sources: string[],
  select: string
): Promise<{ src: string; rows: any[] } | null> {
  for (const src of sources) {
    try {
      const { data, error } = await supabase.from(src).select(select);
      if (error) continue;
      if (Array.isArray(data)) return { src, rows: data };
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET() {
  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";

    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Prefer stable view first (once created in SQL)
    const locSources = [
      "dispatch_driver_locations_view",
      "driver_locations_view",
      "driver_locations",
      "dispatch_driver_locations",
      "drivers_locations",
      "drivers_location",
      "driver_location",
      "admin_driver_locations",
    ];

    const walletSources = [
      "my_driver_live",
      "dispatch_drivers_live_view",
      "drivers_live",
      "drivers",
      "profiles",
    ];

    const locRes = await trySources(supabase, locSources, "*");
    const walletRes = await trySources(supabase, walletSources, "*");

    const locById: Record<string, any> = {};
    const locSrcById: Record<string, string> = {};
    if (locRes) {
      for (const row of locRes.rows) {
        const id = bestDriverId(row);
        if (!id) continue;

        const iso = bestUpdatedAt(row);
        const prev = locById[id];
        if (!prev) {
          locById[id] = row;
          locSrcById[id] = locRes.src;
        } else {
          const prevIso = bestUpdatedAt(prev);
          const best = newest(prevIso, iso);
          if ((best && best === iso && iso !== prevIso) || (!prevIso && iso)) {
            locById[id] = row;
            locSrcById[id] = locRes.src;
          }
        }
      }
    }

    const walletById: Record<string, any> = {};
    const walletSrcById: Record<string, string> = {};
    if (walletRes) {
      for (const row of walletRes.rows) {
        const id = bestDriverId(row);
        if (!id) continue;

        const iso = bestUpdatedAt(row);
        const prev = walletById[id];
        if (!prev) {
          walletById[id] = row;
          walletSrcById[id] = walletRes.src;
        } else {
          const prevIso = bestUpdatedAt(prev);
          const best = newest(prevIso, iso);
          if ((best && best === iso && iso !== prevIso) || (!prevIso && iso)) {
            walletById[id] = row;
            walletSrcById[id] = walletRes.src;
          }
        }
      }
    }

    const ids = new Set<string>([...Object.keys(locById), ...Object.keys(walletById)]);

    const drivers: Record<string, any> = {};
    for (const id of ids) {
      const loc = locById[id];
      const wal = walletById[id];

      const location_updated_at = bestUpdatedAt(loc) ?? bestUpdatedAt(wal) ?? null;
      const driver_status = bestStatus(loc) ?? bestStatus(wal) ?? null;
      const wallet_balance = wal?.wallet_balance ?? wal?.balance ?? wal?.wallet ?? null;
      const min_wallet_required = wal?.min_wallet_required ?? wal?.minWalletRequired ?? wal?.min_required ?? null;
      const wallet_locked = wal?.wallet_locked ?? wal?.walletLocked ?? wal?.locked ?? null;

      const srcParts: string[] = [];
      if (loc && locSrcById[id]) srcParts.push(`loc:${locSrcById[id]}`);
      if (wal && walletSrcById[id]) srcParts.push(`wal:${walletSrcById[id]}`);

      drivers[id] = {
        driver_status,
        wallet_balance,
        min_wallet_required,
        wallet_locked,
        location_updated_at,
      location_updated_at_ph: fmtPH(location_updated_at),
              _src: srcParts.join("+") || null,
      };
    }

    return NextResponse.json({ ok: true, drivers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "drivers-live failed" },
      { status: 500 }
    );
  }
}




