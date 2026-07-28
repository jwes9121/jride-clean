import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireVendorSession } from "@/lib/vendorSession";

export const dynamic = "force-dynamic";

function getAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

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

  const result = await requireVendorSession(req, admin);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
      },
      {
        status: result.status,
      }
    );
  }

  return NextResponse.json({
    ok: true,
    vendor: result.vendor,
  });
}