import { NextResponse } from "next/server";
import { GET as BaseGET } from "../../driver_locations/route";

function normalizeDrivers(list: any, staleMinutes: number) {
  const arr = Array.isArray(list) ? list : [];
  const nowMs = Date.now();
  return arr.map((r: any) => {
    let ageMin = 0;
    try {
      const tsRaw = (r?.updated_at ?? r?.updatedAt ?? null);
      if (tsRaw) {
        const ts = new Date(tsRaw);
        ageMin = (nowMs - ts.getTime()) / 60000;
      }
    } catch {
      ageMin = 0;
    }
    const isStale = ageMin > staleMinutes;
    const originalStatus = (r?.status ?? "unknown");
    const effectiveStatus = (isStale ? "stale" : originalStatus);
    return {
      ...r,
      age_min: Math.round(ageMin * 10) / 10,
      is_stale: isStale,
      effective_status: effectiveStatus,
      status: effectiveStatus,
    };
  });
}

export async function GET(_req: Request) {
  // BaseGET in this codebase expects 0 args (it closes over request context / auth internally)
  const res: any = await BaseGET();

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    return res;
  }

  const staleMinutes = 10;

  if (data && typeof data === "object") {
    if (Object.prototype.hasOwnProperty.call(data, "drivers")) {
      data.drivers = normalizeDrivers(data.drivers, staleMinutes);
    }
    if (Object.prototype.hasOwnProperty.call(data, "driver_locations")) {
      data.driver_locations = normalizeDrivers(data.driver_locations, staleMinutes);
    }
  }

  return NextResponse.json(data, { status: (res?.status ?? 200) });
}