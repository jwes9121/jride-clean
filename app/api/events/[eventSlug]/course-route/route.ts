import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Coordinate = [number, number];

type CourseRouteRow = {
  event_id: string;
  route_name: string;
  official_distance_km: number | string | null;
  measured_distance_km: number | string;
  coordinates: unknown;
  source: string;
  route_version: number;
  updated_at: string;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeCoordinates(value: unknown): Coordinate[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 2 || value.length > 5000) return null;

  const result: Coordinate[] = [];

  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) {
      return null;
    }

    const longitude = Number(item[0]);
    const latitude = Number(item[1]);

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return null;
    }

    const coordinate: Coordinate = [
      Math.round(longitude * 1e7) / 1e7,
      Math.round(latitude * 1e7) / 1e7,
    ];

    const previous = result[result.length - 1];

    if (
      previous &&
      previous[0] === coordinate[0] &&
      previous[1] === coordinate[1]
    ) {
      continue;
    }

    result.push(coordinate);
  }

  return result.length >= 2 ? result : null;
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function segmentDistanceKm(a: Coordinate, b: Coordinate) {
  const earthRadiusKm = 6371.0088;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

  return (
    2 *
    earthRadiusKm *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  );
}

function measuredDistanceKm(coordinates: Coordinate[]) {
  let total = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    total += segmentDistanceKm(
      coordinates[index - 1],
      coordinates[index]
    );
  }

  return Math.round(total * 1000) / 1000;
}

function routeBbox(coordinates: Coordinate[]) {
  let west = coordinates[0][0];
  let east = coordinates[0][0];
  let south = coordinates[0][1];
  let north = coordinates[0][1];

  for (const [longitude, latitude] of coordinates) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  return [west, south, east, north];
}

function routePayload(event: any, row: CourseRouteRow | null) {
  if (!row) {
    return {
      success: true,
      event,
      route: null,
    };
  }

  const coordinates =
    normalizeCoordinates(row.coordinates) || [];

  return {
    success: true,
    event,
    route: {
      routeName: row.route_name,
      officialDistanceKm:
        row.official_distance_km === null
          ? null
          : Number(row.official_distance_km),
      measuredDistanceKm: Number(row.measured_distance_km),
      coordinates,
      bbox:
        coordinates.length >= 2
          ? routeBbox(coordinates)
          : null,
      source: row.source,
      routeVersion: Number(row.route_version || 1),
      updatedAt: row.updated_at,
      geojson: {
        type: "Feature",
        properties: {
          routeName: row.route_name,
          officialDistanceKm:
            row.official_distance_km === null
              ? null
              : Number(row.official_distance_km),
          measuredDistanceKm:
            Number(row.measured_distance_km),
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    },
  };
}

async function loadEventAndRoute(eventSlug: string) {
  const supabase = supabaseAdmin();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,slug,name,short_name,event_date,venue,status")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (eventError) throw new Error(eventError.message);

  if (!event?.id) {
    return {
      supabase,
      event: null,
      route: null,
    };
  }

  const { data: route, error: routeError } = await supabase
    .from("event_course_routes")
    .select(
      "event_id,route_name,official_distance_km,measured_distance_km,coordinates,source,route_version,updated_at"
    )
    .eq("event_id", event.id)
    .maybeSingle();

  if (routeError) throw new Error(routeError.message);

  return {
    supabase,
    event,
    route: (route || null) as CourseRouteRow | null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const context = await loadEventAndRoute(eventSlug);

    if (!context.event) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    return noStore(
      routePayload(context.event, context.route)
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load course route.",
      },
      500
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const eventSlug = cleanText(params.eventSlug);
    const body = await req.json().catch(() => ({}));
    const coordinates = normalizeCoordinates(body.coordinates);
    const routeName =
      cleanText(body.routeName) || "Official Fun Walk Route";

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    if (routeName.length < 3 || routeName.length > 120) {
      return noStore(
        {
          success: false,
          error:
            "Route name must contain 3 to 120 characters.",
        },
        400
      );
    }

    if (!coordinates) {
      return noStore(
        {
          success: false,
          error:
            "Course route requires at least two valid longitude/latitude points.",
        },
        400
      );
    }

    const measured = measuredDistanceKm(coordinates);

    if (measured <= 0 || measured > 100) {
      return noStore(
        {
          success: false,
          error:
            "Measured route distance must be greater than 0 and at most 100 km.",
        },
        400
      );
    }

    const officialRaw = cleanText(body.officialDistanceKm);
    const officialNumber =
      officialRaw === "" ? null : Number(officialRaw);

    if (
      officialNumber !== null &&
      (
        !Number.isFinite(officialNumber) ||
        officialNumber <= 0 ||
        officialNumber > 100
      )
    ) {
      return noStore(
        {
          success: false,
          error:
            "Official distance must be greater than 0 and at most 100 km.",
        },
        400
      );
    }

    const context = await loadEventAndRoute(eventSlug);

    if (!context.event) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const nextVersion =
      Number(context.route?.route_version || 0) + 1;

    const { data: saved, error: saveError } =
      await context.supabase
        .from("event_course_routes")
        .upsert(
          {
            event_id: context.event.id,
            route_name: routeName,
            official_distance_km:
              officialNumber === null
                ? null
                : Math.round(officialNumber * 1000) / 1000,
            measured_distance_km: measured,
            coordinates,
            source: "admin_map_editor",
            route_version: nextVersion,
            updated_by:
              isUuid(authorization.staff.id)
                ? authorization.staff.id
                : null,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "event_id",
            ignoreDuplicates: false,
          }
        )
        .select(
          "event_id,route_name,official_distance_km,measured_distance_km,coordinates,source,route_version,updated_at"
        )
        .single();

    if (saveError) throw new Error(saveError.message);

    return noStore(
      routePayload(
        context.event,
        saved as CourseRouteRow
      ),
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save course route.",
      },
      500
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const context = await loadEventAndRoute(
      cleanText(params.eventSlug)
    );

    if (!context.event) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const { error } = await context.supabase
      .from("event_course_routes")
      .delete()
      .eq("event_id", context.event.id);

    if (error) throw new Error(error.message);

    return noStore({
      success: true,
      route: null,
      message: "Official course route removed.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to remove course route.",
      },
      500
    );
  }
}