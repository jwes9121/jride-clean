import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validSelection } from "@/lib/operations-shift-report";
import { CHANNELS, OUTCOMES } from "@/lib/operations-shift-outreach";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
function failed(error: { code?: string; message?: string }) {
  const status = error.code === "42501" ? 403 : ["40001", "23505"].includes(error.code || "") ? 409 : error.code === "22023" ? 422 : 503;
  return json({ error: status === 503 ? "Driver follow-up records are unavailable. Retry; missing records are not counted as zero." : error.message }, status);
}
export async function GET(request: NextRequest) {
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  const day = request.nextUrl.searchParams.get("day"), duty = request.nextUrl.searchParams.get("duty");
  if (!validSelection(day, duty)) return json({ error: "Choose a valid shift." }, 400);
  try {
    const result = await supabaseAdmin().rpc("operations_shift_outreach_read_v1", {
      p_email: access.staff.email, p_admin: access.staff.role === "admin", p_day: day, p_duty: duty,
    });
    return result.error ? failed(result.error) : json(result.data);
  } catch { return json({ error: "Driver follow-up could not be loaded. Retry." }, 503); }
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
      || !isUuid(input.driver_id) || !isUuid(input.request_id) || (input.previous_contact_id != null && !isUuid(input.previous_contact_id))
      || typeof input.channel !== "string" || !Object.hasOwn(CHANNELS, input.channel)
      || typeof input.outcome !== "string" || !Object.hasOwn(OUTCOMES, input.outcome)
      || typeof input.note !== "string" || input.note.trim().length < 8 || input.note.length > 500 || !/^[\x20-\x7e\r\n]*$/.test(input.note)) {
      return json({ error: "Choose the contact method, outcome and an 8-500 character note." }, 400);
    }
    const result = await supabaseAdmin().rpc("operations_shift_outreach_apply_v1", {
      p_email: access.staff.email, p_admin: access.staff.role === "admin", p_day: input.day, p_duty: input.duty,
      p_driver: input.driver_id, p_channel: input.channel, p_outcome: input.outcome, p_note: input.note.trim(),
      p_request: input.request_id, p_previous: input.previous_contact_id || null,
    });
    return result.error ? failed(result.error) : json(result.data);
  } catch { return json({ error: "Save could not be confirmed. Retry the same action; duplicate requests are protected." }, 503); }
}
