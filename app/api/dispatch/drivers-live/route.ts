import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

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

  // Try many common fields (schema-flex; do not assume any exist)
  const candidates = [
    row.location_updated_at,
    row.locationUpdatedAt,
    row.last_location_at,
    row.lastLocationAt,
    row.last_seen_at,
    row.lastSeenAt,
    row.updated_at,
    row.updatedAt,
    row.ping_at,
    row.pingAt,
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
  const candidates = [
    row.driver_status,
    row.driverStatus,
    row.status,
    row.state,
    row.availability,
  ];
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }
  return null;
}

function bestDriverId(row: any): string | null {
  if (!row) return null;
  const candidates = [
    row.driver_id,
    row.driverId,
    row.driver_uuid,
    row.driverUuid,
    row.id, // some views use id for driver
    row.uuid,
  ];
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }
  return null;
}

// pick first successful source from an ordered list
async function trySources(
  supabase: any,
  sources: string[],
  select: string
): Promise<{ src: string; rows: any[] } | null> {
  for (const src of sources) {
    try {
      const { data, error } = await supabase.from(src).select(select);
      if (error) {
        // silent fallback
        continue;
      }
      if (Array.isArray(data)) {
        return { src, rows: data };
      }
    } catch {
      // silent fallback
    }
  }
  return null;
}

export async function GET() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Prefer realtime location source for freshness
    // NOTE: we select "*" to stay schema-flex (do not assume column names).
    const locSources = [
      "driver_locations",
      "driver_locations_view",
      "dispatch_driver_locations",
      "dispatch_driver_locations_view",
      "drivers_locations",
      "drivers_location",
      "driver_location",
      "admin_driver_locations",
    ];
    const locRes = await trySources(supabase, locSources, "*");

    // 2) Wallet/live info source (balances + min required + lock)
    // Again: schema-flex; we just read what exists.
    const walletSources = [
      "my_driver_live",
      "dispatch_drivers_live_view",
      "drivers_live",
      "drivers",
      "profiles",
    ];
    const walletRes = await trySources(supabase, walletSources, "*");

    // ---- Build best-per-driver maps (dedupe by newest timestamp) ----
    const locById: Record<string, any> = {};
    const locSrcById: Record<string, string> = {};
    if (locRes) {
      for (const row of locRes.rows) {
        const id = bestDriverId(row);
        if (!id) continue;

        const iso = bestUpdatedAt(row);
        // keep newest by timestamp; if no timestamp, keep existing if it has one
        const prev = locById[id];
        if (!prev) {
          locById[id] = row;
          locSrcById[id] = locRes.src;
        } else {
          const prevIso = bestUpdatedAt(prev);
          const best = newest(prevIso, iso);
          // if best is iso, replace; if best is prevIso keep
          if (best && best === iso && iso !== prevIso) {
            locById[id] = row;
            locSrcById[id] = locRes.src;
          } else if (!prevIso && iso) {
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

        // Some wallet sources might also include timestamps; still dedupe
        const iso = bestUpdatedAt(row);
        const prev = walletById[id];
        if (!prev) {
          walletById[id] = row;
          walletSrcById[id] = walletRes.src;
        } else {
          const prevIso = bestUpdatedAt(prev);
          const best = newest(prevIso, iso);
          if (best && best === iso && iso !== prevIso) {
            walletById[id] = row;
            walletSrcById[id] = walletRes.src;
          } else if (!prevIso && iso) {
            walletById[id] = row;
            walletSrcById[id] = walletRes.src;
          }
        }
      }
    }

    // Union of driver IDs from both sources
    const ids = new Set<string>();
    for (const k of Object.keys(locById)) ids.add(k);
    for (const k of Object.keys(walletById)) ids.add(k);

    const drivers: Record<string, any> = {};
    for (const id of ids) {
      const loc = locById[id];
      const wal = walletById[id];

      // prefer realtime location updated_at
      const location_updated_at =
        bestUpdatedAt(loc) ??
        bestUpdatedAt(wal) ??
        null;

      // driver_status: prefer wallet/live status if present, else loc
      const driver_status =
        bestStatus(wal) ??
        bestStatus(loc) ??
        null;

      // wallet fields: only from wallet/live row if present
      const wallet_balance =
        wal?.wallet_balance ??
        wal?.balance ??
        wal?.wallet ??
        null;

      const min_wallet_required =
        wal?.min_wallet_required ??
        wal?.minWalletRequired ??
        wal?.min_required ??
        null;

      const wallet_locked =
        wal?.wallet_locked ??
        wal?.walletLocked ??
        wal?.locked ??
        null;

      // _src: show where freshness came from
      const srcParts: string[] = [];
      if (loc && locSrcById[id]) srcParts.push(`loc:${locSrcById[id]}`);
      if (wal && walletSrcById[id]) srcParts.push(`wal:${walletSrcById[id]}`);

      drivers[id] = {
        driver_status,
        wallet_balance,
        min_wallet_required,
        wallet_locked,
        location_updated_at,
        _src: srcParts.join("+") || null,
      };
    }

    return NextResponse.json({
      ok: true,
      drivers,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "drivers-live failed" },
      { status: 500 }
    );
  }
}
