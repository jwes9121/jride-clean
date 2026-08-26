import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, payload: Record<string, any>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return json(401, { ok: false, error: "UNAUTHORIZED" });

  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const result = await admin.rpc("evaluate_vendor_offline_review_v1");
  if (result.error) {
    return json(500, {
      ok: false,
      error: "VENDOR_COMPLIANCE_SWEEP_FAILED",
      message: result.error.message,
    });
  }

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    review: result.data,
    note: "This sweep creates admin review cases only. It does not automatically suspend a vendor.",
  });
}
