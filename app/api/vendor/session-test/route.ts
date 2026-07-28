import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireVendorSession } from "@/lib/vendorSession";

export const dynamic = "force-dynamic";

function getAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET(req: NextRequest) {
  const requestId =
    req.nextUrl.searchParams.get("rid")?.trim() ||
    `vendor-session-${Date.now()}`;

  console.log("[session-test] start", {
    requestId,
  });

  const admin = getAdmin();

  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIG",
      },
      {
        status: 500,
      }
    );
  }

  const result = await requireVendorSession(req, admin, requestId);

  const vendorId = result.ok ? result.vendor.vendorId : null;

  let credentialRow = null;
  let credentialError = null;

  if (vendorId) {
    const credentialQuery = await admin
      .from("vendor_onboarding_credentials")
      .select("vendor_id,vendor_name,town,status")
      .eq("vendor_id", vendorId);

    credentialRow = credentialQuery.data;
    credentialError = credentialQuery.error?.message || null;
  }

  return NextResponse.json(
    {
      requestId,
      sessionResult: result,
      diagnostic: {
        vendorId,
        credentialRow,
        credentialError,
      },
    },
    {
      status: result.ok ? 200 : result.status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}