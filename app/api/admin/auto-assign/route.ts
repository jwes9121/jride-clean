import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN!;

// Limit number of candidates we send to Mapbox
const MAX_DRIVERS = 8;

type Booking = {
  id: string;
  pickup_lat: number;
  pickup_lng: number;
  status: string;
};

type DriverLocation = {
  driver_id: string;
  lat: number;
  lng: number;
};

type DriverWallet = {
  id: string;
  wallet_balance: number | null;
  min_wallet_required: number | null;
  wallet_locked: boolean | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function effectiveMinWalletRequired(v: unknown): number {
  const n = num(v);
  if (n == null) return 250;
  return Math.max(250, n);
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

async function getRoadDurationsSeconds(
  pickup: { lat: number; lng: number },
  drivers: DriverLocation[]
): Promise<{ driver_id: string; duration: number }[]> {
  if (!drivers.length) return [];

  const allCoords = [
    ...drivers.map((d) => `${d.lng},${d.lat}`),
    `${pickup.lng},${pickup.lat}`,
  ].join(";");

  const destinationsIndex = drivers.length;

  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${allCoords}?sources=${drivers
    .map((_, idx) => idx)
    .join(",")}&destinations=${destinationsIndex}&annotations=duration&access_token=${mapboxToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("MAPBOX_MATRIX_ERROR", res.status, await res.text());
    throw new Error("Failed to get route durations from Mapbox");
  }

  const json = (await res.json()) as {
    durations: (number | null)[][];
  };

  const durations = json.durations || [];

  return drivers.map((driver, idx) => {
    const row = durations[idx] || [];
    const dur = row[0] ?? row[destinationsIndex] ?? null;
    return {
      driver_id: driver.driver_id,
      duration: dur ?? Number.MAX_SAFE_INTEGER,
    };
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking_id } = body as { booking_id: string };

    if (!booking_id) {
      return NextResponse.json(
        { success: false, error: "Missing booking_id" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, pickup_lat, pickup_lng, status, assigned_driver_id")
      .eq("id", booking_id)
      .single<Booking>();

    if (bookingError || !booking) {
      console.error("AUTO_ASSIGN_BOOKING_ERROR", bookingError);
      return NextResponse.json(
        { success: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    if (booking.pickup_lat == null || booking.pickup_lng == null) {
      return NextResponse.json(
        { success: false, error: "Booking missing pickup coordinates" },
        { status: 400 }
      );
    }

    const { data: driverLocs, error: driverError } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, is_online")
      .eq("is_online", true);

    if (driverError) {
      console.error("AUTO_ASSIGN_DRIVER_LOC_ERROR", driverError);
      return NextResponse.json(
        { success: false, error: "Failed to load driver locations" },
        { status: 500 }
      );
    }

    const rawDrivers: DriverLocation[] =
      (driverLocs || [])
        .filter((d: any) => d.lat != null && d.lng != null)
        .map((d: any) => ({
          driver_id: d.driver_id,
          lat: d.lat,
          lng: d.lng,
        })) || [];

    if (!rawDrivers.length) {
      return NextResponse.json(
        { success: false, error: "No online drivers available" },
        { status: 409 }
      );
    }

    const driverIds = rawDrivers.map((d) => d.driver_id);
    const { data: walletRows, error: walletError } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .in("id", driverIds);

    if (walletError) {
      console.error("AUTO_ASSIGN_DRIVER_WALLET_ERROR", walletError);
      return NextResponse.json(
        { success: false, error: "Failed to load driver wallets" },
        { status: 500 }
      );
    }

    const walletByDriverId = new Map<string, DriverWallet>();
    for (const row of (walletRows || []) as DriverWallet[]) {
      walletByDriverId.set(row.id, row);
    }

    const drivers = rawDrivers.filter((d) => {
      const wallet = walletByDriverId.get(d.driver_id);
      if (!wallet) return false;
      if (Boolean(wallet.wallet_locked)) return false;
      const balance = num(wallet.wallet_balance) ?? 0;
      const minRequired = effectiveMinWalletRequired(wallet.min_wallet_required);
      return balance >= minRequired;
    });

    if (!drivers.length) {
      return NextResponse.json(
        { success: false, error: "No wallet-eligible online drivers available" },
        { status: 409 }
      );
    }

    const withDist = drivers.map((d) => ({
      ...d,
      km: haversineKm(booking.pickup_lat, booking.pickup_lng, d.lat, d.lng),
    }));

    withDist.sort((a, b) => a.km - b.km);

    const candidates = withDist.slice(0, MAX_DRIVERS);

    const durations = await getRoadDurationsSeconds(
      { lat: booking.pickup_lat, lng: booking.pickup_lng },
      candidates
    );

    const best = durations.reduce<{
      driver_id: string | null;
      duration: number;
    }>(
      (acc, cur) =>
        cur.duration < acc.duration ? cur : acc,
      { driver_id: null, duration: Number.MAX_SAFE_INTEGER }
    );

    if (!best.driver_id || !Number.isFinite(best.duration)) {
      return NextResponse.json(
        { success: false, error: "Could not determine best driver" },
        { status: 500 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: best.driver_id,
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .select("id, booking_code, status, assigned_driver_id")
      .single();

    if (updateError) {
      console.error("AUTO_ASSIGN_UPDATE_ERROR", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to assign driver" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        booking: updated,
        chosen_driver_id: best.driver_id,
        eta_seconds: best.duration,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("AUTO_ASSIGN_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
