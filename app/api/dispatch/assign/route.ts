import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AssignBody = {
  bookingCode?: string;
  driverId?: string;
};

function bad(message: string, extra: any = {}, status = 400) {
  return NextResponse.json({ ok: false, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

function safeHost(u: string) {
  try { return new URL(u).host; } catch { return ""; }
}

function pickPresentKeys(sample: Record<string, any>, candidates: string[]) {
  return candidates.filter((c) => Object.prototype.hasOwnProperty.call(sample, c));
}

export async function POST(request: Request) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return bad("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL", {}, 500);
  if (!serviceKey) return bad("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)", {}, 500);

  let body: AssignBody;
  try {
    body = (await request.json()) as AssignBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const bookingCode = body.bookingCode ? String(body.bookingCode).trim() : "";
  const driverId = body.driverId ? String(body.driverId).trim() : "";

  if (!bookingCode) return bad("Missing bookingCode");
  if (!driverId) return bad("Missing driverId");

  const where = `booking_code=eq.${encodeURIComponent(bookingCode)}`;
  const baseUrl = `${supabaseUrl}/rest/v1/bookings?${where}`;

  // 1) Read row first (so we don't assume column names)
  const readRes = await fetch(`${baseUrl}&select=*`, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    cache: "no-store",
  });

  const readText = await readRes.text();
  if (!readRes.ok) {
    return bad("READ_FAILED", { httpStatus: readRes.status, detail: readText }, readRes.status);
  }

  let rows: any[] = [];
  try { rows = JSON.parse(readText); } catch {}
  if (!Array.isArray(rows) || rows.length === 0) {
    return bad("BOOKING_NOT_FOUND", { bookingCode }, 404);
  }

  const sample = rows[0] as Record<string, any>;

  // Driver id columns we support
  const driverCols = pickPresentKeys(sample, ["driver_id", "assigned_driver_id"]);

  // Status columns we support (same family as status route)
  const statusCols = pickPresentKeys(sample, ["status", "trip_status", "booking_status", "dispatch_status", "ride_status"]);

  if (driverCols.length === 0) {
    return bad("NO_DRIVER_COLUMNS_FOUND", {
      hint: "Bookings row has no driver_id/assigned_driver_id. Update the schema or adjust candidates.",
      keys: Object.keys(sample).slice(0, 80),
    }, 409);
  }

  // 2) Build patch body using ONLY present columns
  const patchBody: any = {};
  for (const c of driverCols) patchBody[c] = driverId;

  // If there is a status-like column, set it to 'assigned'
  for (const s of statusCols) patchBody[s] = "assigned";

  // 3) Patch
  const patchRes = await fetch(baseUrl, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patchBody),
    cache: "no-store",
  });

  const patchText = await patchRes.text();
  if (!patchRes.ok) {
    return bad("PATCH_FAILED", {
      httpStatus: patchRes.status,
      detail: patchText,
      attempted: patchBody,
      supabaseHost: safeHost(supabaseUrl),
    }, patchRes.status);
  }

  let patched: any[] = [];
  try { patched = JSON.parse(patchText); } catch {}

  return NextResponse.json({
    ok: true,
    bookingCode: patched?.[0]?.booking_code ?? bookingCode,
    id: patched?.[0]?.id ?? rows?.[0]?.id ?? null,
    assignedDriverId: driverId,
    columnsUpdated: [...driverCols, ...statusCols],
    supabaseHost: safeHost(supabaseUrl),
  }, { headers: { "Cache-Control": "no-store" } });
}
