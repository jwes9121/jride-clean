import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 2000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const inquiryId = clean(body?.inquiry_id, 80);
  const amount = numberOrNull(body?.total_amount);
  const validUntil = clean(body?.valid_until, 80);

  if (!inquiryId) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INQUIRY_REQUIRED", message: "Inquiry is required." },
      { status: 400, headers }
    );
  }

  if (amount === null || amount <= 0 || amount > 100000000) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_QUOTE_AMOUNT_INVALID", message: "Enter a valid quotation amount." },
      { status: 400, headers }
    );
  }

  const validity = new Date(validUntil);
  if (!validUntil || !Number.isFinite(validity.getTime()) || validity.getTime() <= Date.now()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_QUOTE_VALIDITY_INVALID", message: "Quotation validity must be in the future." },
      { status: 400, headers }
    );
  }

  const items = Array.isArray(body?.items)
    ? body.items.slice(0, 20).map((item: any) => ({
        item_type: clean(item?.item_type || "other", 40).toLowerCase(),
        label: clean(item?.label, 180),
        amount: numberOrNull(item?.amount) ?? 0,
        included: item?.included !== false,
        notes: clean(item?.notes, 500) || null,
      }))
    : [];

  if (items.some((item: any) => !item.label || item.amount < 0)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_QUOTE_ITEMS_INVALID", message: "Review the quotation breakdown." },
      { status: 400, headers }
    );
  }

  const includedTotal = items
    .filter((item: any) => item.included)
    .reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);

  if (items.length && Math.abs(includedTotal - amount) > 0.009) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_QUOTE_ITEMS_TOTAL_MISMATCH",
        message: "Included quotation items must add up to the total quotation.",
      },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_send_quote_v1", {
    p_inquiry_id: inquiryId,
    p_owner_user_id: auth.user.id,
    p_total_amount: amount,
    p_valid_until: validity.toISOString(),
    p_inclusions: clean(body?.inclusions, 2000) || null,
    p_exclusions: clean(body?.exclusions, 2000) || null,
    p_pricing_notes: clean(body?.pricing_notes, 2000) || null,
    p_fuel_basis_note: clean(body?.fuel_basis_note, 1000) || null,
    p_items: items,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    const known =
      message.includes("JFLEET_INQUIRY") ||
      message.includes("JFLEET_QUOTE") ||
      message.includes("JFLEET_OWNER") ||
      message.includes("JFLEET_CURRENT_ITINERARY");
    return NextResponse.json(
      {
        ok: false,
        code: known ? "JFLEET_QUOTE_REJECTED" : "JFLEET_QUOTE_CREATE_FAILED",
        message: known
          ? "This inquiry can no longer receive that quotation. Refresh and review its current status."
          : "The quotation could not be saved.",
      },
      { status: known ? 409 : 500, headers }
    );
  }

  return NextResponse.json(result.data, { status: 201, headers });
}
