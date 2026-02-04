import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/eta
 * Query params:
 *   origin=lng,lat
 *   destination=lng,lat
 *
 * Returns:
 *   { etaSeconds, distanceMeters }
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const origin = searchParams.get("origin");
    const destination = searchParams.get("destination");

    if (!origin || !destination) {
      return NextResponse.json(
        { error: "Missing origin or destination" },
        { status: 400 }
      );
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      console.error("ETA API: NEXT_PUBLIC_MAPBOX_TOKEN is missing");
      return NextResponse.json(
        { error: "Mapbox token not configured" },
        { status: 500 }
      );
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${destination}?overview=false&geometries=polyline&access_token=${token}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("ETA API: Mapbox HTTP error:", response.status, text);
      return NextResponse.json(
        { error: "Failed to fetch directions from Mapbox" },
        { status: 502 }
      );
    }

    const json = await response.json();

    if (!json.routes || json.routes.length === 0) {
      return NextResponse.json(
        { error: "No route found" },
        { status: 404 }
      );
    }

    const route = json.routes[0];

    const etaSeconds =
      typeof route.duration === "number" ? route.duration : null;
    const distanceMeters =
      typeof route.distance === "number" ? route.distance : null;

    return NextResponse.json(
      { etaSeconds, distanceMeters },
      { status: 200 }
    );
  } catch (error) {
    console.error("ETA API: internal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
