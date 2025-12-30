import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = (obj as any)[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

/**
 * Accept trips in any shape:
 * - array
 * - { trips: [...] }
 * - { bookings: [...] }
 * - { data: [...] }
 * - numeric keys: { "0": {...}, "1": {...}, ... }
 */
function extractTripsAnyShape(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  if (typeof payload === "object") {
    const t1 = (payload as any).trips;
    if (Array.isArray(t1)) return t1;

    const t2 = (payload as any).bookings;
    if (Array.isArray(t2)) return t2;

    const t3 = (payload as any).data;
    if (Array.isArray(t3)) return t3;

    // numeric keys
    const keys = Object.keys(payload)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.map((k) => (payload as any)[k]).filter(Boolean);
  }

  return [];
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();

    // 1) RPC page data
    const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_get_live_trips_page_data");
    if (rpcErr) {
      console.error("LIVETRIPS_RPC_ERROR", rpcErr);
      return bad("LiveTrips RPC failed", "LIVETRIPS_RPC_ERROR", 500, { details: rpcErr.message });
    }

    // 2) Extract trips safely (do NOT mutate rpcData output)
    const tripsRaw = extractTripsAnyShape(rpcData);

    // FALLBACK_ACTIVE_BOOKINGS_MERGE_BEGIN
    // If RPC doesn't include some active statuses (ex: 'arrived'), we still want them in the table.
    // We pull directly from bookings and merge any missing by id/booking_code.
    const existingCodes = new Set(
      (tripsRaw as any[])
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );
    const existingIds = new Set(
      (tripsRaw as any[])
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const ACTIVE_STATUSES = ["assigned", "on_the_way", "arrived", "enroute", "on_trip"];

    try {
      const { data: activeRows, error: activeErr } = await supabase
        .from("bookings")
        .select("*")
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(200);

      if (activeErr) {
        console.error("LIVETRIPS_FALLBACK_ACTIVE_ERROR", activeErr);
      } else if (Array.isArray(activeRows) && activeRows.length) {
        for (const b of activeRows) {
          const bid = b?.id != null ? String(b.id) : "";
          const bcode = b?.booking_code != null ? String(b.booking_code) : "";

          // Merge only if missing from RPC list
          if ((bid && existingIds.has(bid)) || (bcode && existingCodes.has(bcode))) continue;

          // Shape into a "trip-like" object for the frontend
          const tripLike: any = {
            id: bid || null,
            uuid: bid || null,
            booking_id: bid || null,
            booking_code: bcode || null,
            status: b?.status ?? null,
            town: b?.town ?? null,
            zone: b?.town ?? null,
            driver_id: b?.driver_id ?? null,

            pickup_lat: b?.pickup_lat ?? null,
            pickup_lng: b?.pickup_lng ?? null,
            dropoff_lat: b?.dropoff_lat ?? null,
            dropoff_lng: b?.dropoff_lng ?? null,

            // labels (support both naming styles)
            pickup_label: b?.pickup_label ?? b?.from_label ?? null,
            dropoff_label: b?.dropoff_label ?? b?.to_label ?? null,

            created_at: b?.created_at ?? null,
            updated_at: b?.updated_at ?? null,
            trip_type: b?.trip_type ?? null,
            vendor_id: b?.vendor_id ?? null
          };

          (tripsRaw as any[]).push(tripLike);

          if (bid) existingIds.add(bid);
          if (bcode) existingCodes.add(bcode);
        }
      }
    } catch (e: any) {
      console.error("LIVETRIPS_FALLBACK_ACTIVE_EXCEPTION", e?.message || e);
    }
    // FALLBACK_ACTIVE_BOOKINGS_MERGE_END
    // --- ARRIVED_INJECTOR_START ---
    // If the RPC does not include 'arrived' trips, inject them directly from bookings so LiveTrips can show Arrived immediately.
    // We only select known-safe columns to avoid schema assumptions.
    const rpcIds = new Set(
      tripsRaw
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const rpcCodes = new Set(
      tripsRaw
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    // Pull arrived bookings (these often get omitted by RPC filters upstream)
    const { data: arrivedRows, error: arrivedErr } = await supabase
      .from("bookings")
      .select("id, booking_code, status, town, driver_id, vendor_id, trip_type")
      .eq("status", "arrived")
      .order("created_at", { ascending: false })
      .limit(50);

    if (arrivedErr) {
      console.error("LIVETRIPS_ARRIVED_INJECT_ERROR", arrivedErr);
    } else if (arrivedRows?.length) {
      const arrivedTrips = (arrivedRows as any[])
        .filter((b) => {
          const id = b?.id ? String(b.id) : "";
          const code = b?.booking_code ? String(b.booking_code) : "";
          if (id && rpcIds.has(id)) return false;
          if (code && rpcCodes.has(code)) return false;
          return true;
        })
        .map((b) => ({
          id: b.id,
          uuid: b.id,
          booking_code: b.booking_code,
          status: b.status,
          driver_id: b.driver_id ?? null,
          vendor_id: b.vendor_id ?? null,
          trip_type: b.trip_type ?? null,
          zone: b.town ?? null,
          town: b.town ?? null,
          __injected: true
        }));

      if (arrivedTrips.length) {
        // Merge: keep RPC trips first (rich data), then injected arrived (minimal but visible in UI)
        tripsRaw.push(...arrivedTrips);
        console.log("LIVETRIPS_ARRIVED_INJECTED_COUNT", arrivedTrips.length);
      }
    }
    // --- ARRIVED_INJECTOR_END ---


    // 3) Gather booking codes + ids from trips
    const bookingCodes = uniq(
      tripsRaw
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
    );

    const bookingIds = uniq(
      tripsRaw
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
    );

    // 4) Pull vendor_id / driver_id / trip_type from bookings table to inject into trip objects
    const byCode: Record<string, any> = {};
    const byId: Record<string, any> = {};

    if (bookingCodes.length) {
      const { data: rows, error } = await supabase
        .from("bookings")
        .select("id, booking_code, vendor_id, driver_id, trip_type, town, status")
        .in("booking_code", bookingCodes);

      if (error) {
        console.error("LIVETRIPS_BOOKINGS_BY_CODE_ERROR", error);
      } else {
        for (const r of rows ?? []) {
          if (r?.booking_code) byCode[String(r.booking_code)] = r;
          if (r?.id) byId[String(r.id)] = r;
        }
      }
    }

    if (bookingIds.length) {
      const { data: rows, error } = await supabase
        .from("bookings")
        .select("id, booking_code, vendor_id, driver_id, trip_type, town, status")
        .in("id", bookingIds);

      if (error) {
        console.error("LIVETRIPS_BOOKINGS_BY_ID_ERROR", error);
      } else {
        for (const r of rows ?? []) {
          if (r?.id) byId[String(r.id)] = r;
          if (r?.booking_code) byCode[String(r.booking_code)] = r;
        }
      }
    }

    // 5) Build enriched trip objects (VENDOR_ID_AUTOFILL + DRIVER_ID + TRIP_TYPE + optional zone assist)
    const tripsEnriched = (tripsRaw as any[]).map((t: any) => {
      const bc = pick(t, ["booking_code", "bookingCode", "code"]);
      const id = pick(t, ["id", "uuid", "booking_id", "bookingId"]);
      const b = (bc && byCode[String(bc)]) || (id && byId[String(id)]) || null;

      if (!b) return { ...t };

      const out: any = { ...t };

      // vendor_id (critical for vendor ledger)
      const hasVendor = pick(out, ["vendor_id", "vendorId"]);
      if (!hasVendor && b.vendor_id) out.vendor_id = b.vendor_id;

      // driver_id
      const hasDriver = pick(out, ["driver_id", "driverId"]);
      if (!hasDriver && b.driver_id) out.driver_id = b.driver_id;

      // trip_type
      const hasType = pick(out, ["trip_type", "tripType"]);
      if (!hasType && b.trip_type) out.trip_type = b.trip_type;

      // town/zone (minor assist)
      const hasTown = pick(out, ["town", "zone"]);
      if (!hasTown && b.town) out.zone = b.town;

      return out;
    });

    // 6) Wallet balances (views you already confirmed exist)
    const driverIds = uniq(
      tripsEnriched
        .map((t: any) => pick(t, ["driver_id", "driverId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
    );

    const vendorIds = uniq(
      tripsEnriched
        .map((t: any) => pick(t, ["vendor_id", "vendorId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
    );

    const driverWalletBalances: Record<string, number> = {};
    if (driverIds.length) {
      const { data, error } = await supabase
        .from("driver_wallet_balances_v1")
        .select("driver_id, balance")
        .in("driver_id", driverIds);

      if (error) {
        console.error("DRIVER_WALLET_BALANCES_ERROR", error);
      } else {
        for (const r of data ?? []) {
          if (r?.driver_id != null) driverWalletBalances[String(r.driver_id)] = Number(r.balance ?? 0);
        }
      }
    }

    const vendorWalletBalances: Record<string, number> = {};
    if (vendorIds.length) {
      const { data, error } = await supabase
        .from("vendor_wallet_balances_v1")
        .select("vendor_id, balance")
        .in("vendor_id", vendorIds);

      if (error) {
        console.error("VENDOR_WALLET_BALANCES_ERROR", error);
      } else {
        for (const r of data ?? []) {
          if (r?.vendor_id != null) vendorWalletBalances[String(r.vendor_id)] = Number(r.balance ?? 0);
        }
      }
    }

    // 6.5) OPTIONAL ADD-ON: attach balances onto each trip so TripWalletPanel can show them on-card
    // (TripWalletPanel reads: trip.driver_wallet_balance / trip.vendor_wallet_balance)
    const tripsWithBalances = tripsEnriched.map((t: any) => {
      const out: any = { ...t };

      const dId = pick(out, ["driver_id", "driverId"]);
      const vId = pick(out, ["vendor_id", "vendorId"]);

      const hasDriverBal = pick(out, ["driver_wallet_balance", "driver_wallet", "driverWallet"]);
      const hasVendorBal = pick(out, ["vendor_wallet_balance", "vendor_wallet", "vendorWallet"]);

      if (!hasDriverBal && dId && Object.prototype.hasOwnProperty.call(driverWalletBalances, String(dId))) {
        out.driver_wallet_balance = driverWalletBalances[String(dId)];
      }

      if (!hasVendorBal && vId && Object.prototype.hasOwnProperty.call(vendorWalletBalances, String(vId))) {
        out.vendor_wallet_balance = vendorWalletBalances[String(vId)];
      }

      return out;
    });

    // 7) Zones workload (non-fatal if missing)
    let zones: any[] = [];
    try {
      const { data, error } = await supabase.from("zone_capacity_view").select("*");
      if (!error && Array.isArray(data)) zones = data;
    } catch {
      // ignore
    }

    // 8) Response shape: keep numeric keys + trips + balances + zones
    const out: any = {};
    for (let i = 0; i < tripsWithBalances.length; i++) out[String(i)] = tripsWithBalances[i];
    out.trips = tripsWithBalances;
    out.zones = zones;
    out.driverWalletBalances = driverWalletBalances;
    out.vendorWalletBalances = vendorWalletBalances;

    return ok(out);
  } catch (e: any) {
    console.error("LIVETRIPS_PAGE_DATA_UNHANDLED", e);
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}


