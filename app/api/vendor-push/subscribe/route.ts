import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = serviceClient();
    if (!supabase) {
      return json(500, { ok: false, error: "MISSING_SUPABASE_SERVICE_ROLE" });
    }

    const body = await req.json().catch(() => null);
    const vendorId = String(body?.vendor_id || body?.vendorId || "").trim();
    const subscription = body?.subscription || null;
    const endpoint = String(subscription?.endpoint || "").trim();

    if (!vendorId) return json(400, { ok: false, error: "MISSING_VENDOR_ID" });
    if (!subscription || !endpoint) return json(400, { ok: false, error: "MISSING_SUBSCRIPTION" });

    const { error } = await supabase
      .from("vendor_push_subscriptions")
      .upsert(
        {
          vendor_id: vendorId,
          endpoint,
          subscription,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      return json(500, { ok: false, error: "DB_ERROR", message: error.message });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, error: "UNEXPECTED", message: String(e?.message || e) });
  }
}
