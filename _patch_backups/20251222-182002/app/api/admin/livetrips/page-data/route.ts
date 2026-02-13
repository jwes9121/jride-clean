import { NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnyObj = Record<string, any>;

function isArray(v: any): v is any[] {
  return Array.isArray(v);
}

function extractTripsAnyShape(src: any): any[] {
  if (!src) return [];
  if (Array.isArray(src)) return src;

  // Common container shapes
  if (typeof src === "object") {
    const cands = [(src as AnyObj).trips, (src as AnyObj).bookings, (src as AnyObj).data];
    for (const c of cands) {
      if (Array.isArray(c)) return c;
    }

    // Numeric-key object: { "0": {...}, "1": {...} }
    const keys = Object.keys(src).filter((k) => /^\d+$/.test(k));
    if (keys.length) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((k) => (src as AnyObj)[k]);
    }
  }

  return [];
}

export async function GET() {
  // Admin API must not depend on browser session cookies (RLS-safe)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
  }
  if (!serviceKey) {
    return NextResponse.json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const supabase = createSbClient(supabaseUrl, serviceKey);

  // 1) Base data
  const [{ data: rpcData, error: rpcError }, { data: zoneData, error: zoneError }] =
    await Promise.all([
      supabase.rpc("admin_get_live_trips_page_data"),
      supabase
        .from("zone_capacity_view")
        .select(
          "zone_id, zone_name, color_hex, capacity_limit, active_drivers, available_slots, status"
        )
        .order("zone_name"),
    ]);

  if (rpcError) {
    console.error("[page-data] live trips RPC error", rpcError);
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }
  if (zoneError) {
    console.error("[zone-capacity] error", zoneError);
    return NextResponse.json({ error: zoneError.message }, { status: 500 });
  }

  // 2) Extract trips (handles numeric-key shapes)
  const baseTrips = extractTripsAnyShape(rpcData);

  // 3) Wallet enrichment (best-effort, never blocks response)
  const driverWalletBalances: Record<string, number> = {};
  const vendorWalletBalances: Record<string, number> = {};
  const bookingToVendor: Record<string, string> = {};

  try {
    const driverIds = Array.from(
      new Set(
        baseTrips
          .map((t: any) => t?.driver_id ?? t?.driverId ?? null)
          .filter((x: any) => typeof x === "string" && x.length > 0)
      )
    );

    const bookingCodes = Array.from(
      new Set(
        baseTrips
          .map((t: any) => t?.booking_code ?? t?.bookingCode ?? null)
          .filter((x: any) => typeof x === "string" && x.length > 0)
      )
    );

    // Driver balances
    if (driverIds.length) {
      const { data: drows, error: derr } = await supabase
        .from("driver_wallet_balances_v1")
        .select("driver_id, balance")
        .in("driver_id", driverIds);

      if (derr) {
        console.error("[wallet] driver_wallet_balances_v1 error", derr);
      } else {
        for (const r of drows ?? []) {
          if (r?.driver_id) driverWalletBalances[String(r.driver_id)] = Number(r.balance ?? 0);
        }
      }
    }

    // booking_code -> vendor_id mapping from vendor_wallet_transactions
    if (bookingCodes.length) {
      const { data: vtx, error: vtxErr } = await supabase
        .from("vendor_wallet_transactions")
        .select("booking_code, vendor_id, created_at")
        .in("booking_code", bookingCodes)
        .order("created_at", { ascending: false });

      if (vtxErr) {
        console.error("[wallet] vendor_wallet_transactions lookup error", vtxErr);
      } else {
        for (const row of vtx ?? []) {
          const bc = String(row?.booking_code ?? "");
          const vid = String(row?.vendor_id ?? "");
          if (!bc || !vid) continue;
          if (!bookingToVendor[bc]) bookingToVendor[bc] = vid; // first seen = latest (ordered desc)
        }

        const vendorIds = Array.from(new Set(Object.values(bookingToVendor)));
        if (vendorIds.length) {
          const { data: vbals, error: vbErr } = await supabase
            .from("vendor_wallet_balances_v1")
            .select("vendor_id, balance")
            .in("vendor_id", vendorIds);

          if (vbErr) {
            console.error("[wallet] vendor_wallet_balances_v1 error", vbErr);
          } else {
            for (const r of vbals ?? []) {
              if (r?.vendor_id) vendorWalletBalances[String(r.vendor_id)] = Number(r.balance ?? 0);
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.error("[wallet] enrichment failed (non-blocking)", e?.message || e);
  }

  const enrichedTrips = baseTrips.map((t: any) => {
    const driverId = t?.driver_id ?? t?.driverId ?? null;
    const bookingCode = t?.booking_code ?? t?.bookingCode ?? null;

    const driverWallet =
      driverId && driverWalletBalances[String(driverId)] !== undefined
        ? driverWalletBalances[String(driverId)]
        : null;

    let vendorWallet: number | null = null;
    if (bookingCode && bookingToVendor[String(bookingCode)]) {
      const vid = bookingToVendor[String(bookingCode)];
      if (vendorWalletBalances[vid] !== undefined) vendorWallet = vendorWalletBalances[vid];
    }

    return {
      ...t,
      driver_wallet_balance: driverWallet,
      vendor_wallet_balance: vendorWallet,
    };
  });

  // Backward-compatible numeric-key payload
  const numericPayload: AnyObj = {};
  enrichedTrips.forEach((t, i) => {
    numericPayload[String(i)] = t;
  });

  return NextResponse.json(
    {
      ...numericPayload,
      trips: enrichedTrips,
      zones: zoneData ?? [],
      driverWalletBalances,
      vendorWalletBalances,
    },
    { status: 200 }
  );
}