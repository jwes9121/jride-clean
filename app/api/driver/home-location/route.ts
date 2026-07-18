import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  noStoreHeaders,
  resolveAuthenticatedDriver,
} from "@/lib/advance-booking/driverAuth";

export const dynamic = "force-dynamic";

function numberOrNaN(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function validCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizeAddressHint(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, 500);
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      {
        status: auth.status,
        headers: noStoreHeaders(),
      }
    );
  }

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("driver_home_locations")
    .select("driver_id, home_lat, home_lng, address_hint, set_at, updated_at")
    .eq("driver_id", auth.driverId)
    .maybeSingle();

  if (error) {
    console.error("[driver:home-location:get]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "HOME_LOCATION_LOOKUP_FAILED",
        message: error.message,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        ok: true,
        hasHome: false,
        home: null,
      },
      {
        headers: noStoreHeaders(),
      }
    );
  }

  const homeLat = Number((data as any).home_lat);
  const homeLng = Number((data as any).home_lng);

  if (!validCoordinate(homeLat, homeLng)) {
    console.error("[driver:home-location:get] invalid stored coordinates", {
      driverId: auth.driverId,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_STORED_HOME_LOCATION",
        message: "The saved home location has invalid coordinates.",
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      hasHome: true,
      home: {
        lat: homeLat,
        lng: homeLng,
        addressHint: (data as any).address_hint ?? null,
        setAt: (data as any).set_at ?? null,
        updatedAt: (data as any).updated_at ?? null,
      },
    },
    {
      headers: noStoreHeaders(),
    }
  );
}

export async function PUT(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      {
        status: auth.status,
        headers: noStoreHeaders(),
      }
    );
  }

  const body = await req.json().catch(() => ({}));

  const homeLat = numberOrNaN(body?.homeLat);
  const homeLng = numberOrNaN(body?.homeLng);
  const addressHint = normalizeAddressHint(body?.addressHint);

  if (!validCoordinate(homeLat, homeLng)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_HOME_COORDINATES",
        message: "Home latitude and longitude are invalid.",
      },
      {
        status: 400,
        headers: noStoreHeaders(),
      }
    );
  }

  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("driver_home_locations")
    .upsert(
      {
        driver_id: auth.driverId,
        home_lat: homeLat,
        home_lng: homeLng,
        address_hint: addressHint,
        updated_at: nowIso,
      },
      {
        onConflict: "driver_id",
      }
    )
    .select("driver_id, home_lat, home_lng, address_hint, set_at, updated_at")
    .single();

  if (error) {
    console.error("[driver:home-location:put]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "HOME_LOCATION_SAVE_FAILED",
        message: error.message,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Home location saved.",
      home: {
        lat: Number((data as any).home_lat),
        lng: Number((data as any).home_lng),
        addressHint: (data as any).address_hint ?? null,
        setAt: (data as any).set_at ?? null,
        updatedAt: (data as any).updated_at ?? null,
      },
    },
    {
      headers: noStoreHeaders(),
    }
  );
}
