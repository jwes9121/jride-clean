import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SHIFT_ACTIONS, validSelection } from "@/lib/operations-shift-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}
function failure(error: { code?: string; message?: string }) {
  const status = error.code === "42501" ? 403 : ["40001", "23505"].includes(error.code || "") ? 409 : error.code === "22023" ? 422 : 503;
  if (status === 503) console.error("[shift-report] Database operation failed", error.code || "unknown");
  return json({ error: status === 503 ? "Shift reporting is temporarily unavailable. No missing data has been replaced with zero. Retry." : error.message || "Unable to save this action." }, status);
}
export async function GET(request: NextRequest) {
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  try {
    const db = supabaseAdmin();
    const actor = { p_email: access.staff.email, p_admin: access.staff.role === "admin" };
    if (request.nextUrl.searchParams.get("mode") === "catalog") {
      const result = await db.rpc("operations_shift_catalog_v1", actor);
      return result.error ? failure(result.error) : json(result.data);
    }
    const day = request.nextUrl.searchParams.get("day");
    const duty = request.nextUrl.searchParams.get("duty");
    if (!validSelection(day, duty)) return json({ error: "Choose a valid date and Primary or Evening shift." }, 400);
    const result = await db.rpc("operations_shift_read_v1", {
      ...actor, p_day: day, p_duty: duty, p_presence: request.nextUrl.searchParams.get("presence") !== "0",
    });
    return result.error ? failure(result.error) : json(result.data);
  } catch { return json({ error: "Shift report could not be loaded. Retry without changing the schedule." }, 503); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  try {
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: "Request is too large." }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input) || !validSelection(input.day, input.duty)
      || !Number.isSafeInteger(input.version) || Number(input.version) < 0 || Number(input.version) > 2147483647
      || !SHIFT_ACTIONS.some(action => action === input.action)
      || typeof input.request_id !== "string" || !uuid.test(input.request_id)
      || (input.booking_id != null && (typeof input.booking_id !== "string" || !uuid.test(input.booking_id)))
      || typeof input.note !== "string" || input.note.length > 500 || !/^[\x20-\x7e\r\n]*$/.test(input.note)
      || (input.target != null && (typeof input.target !== "string" || input.target.length > 100))) {
      return json({ error: "Invalid action. Refresh the report and check the reason." }, 400);
    }
    const result = await supabaseAdmin().rpc("operations_shift_apply_v1", {
      p_email: access.staff.email, p_admin: access.staff.role === "admin", p_day: input.day, p_duty: input.duty,
      p_version: input.version, p_action: input.action, p_booking: input.booking_id || null,
      p_note: input.note.trim(), p_target: input.target || null, p_request: input.request_id,
    });
    return result.error ? failure(result.error) : json(result.data);
  } catch { return json({ error: "The save could not be confirmed. Retry the same action; duplicate requests are protected." }, 503); }
}
