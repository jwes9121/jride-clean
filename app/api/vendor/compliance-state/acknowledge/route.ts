import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  verifyLegacyComplianceAcknowledgementToken,
} from "@/lib/vendorComplianceLegacyToken";
import { requireVendorSession } from "@/lib/vendorSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, payload: Record<string, any>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
    clean(value)
  );
}

function adminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Vendor compliance service is not configured.",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const suppliedSanctionId = clean(body?.sanction_id);
  const session = await requireVendorSession(req, admin);

  let vendorId = "";
  let sanctionId = suppliedSanctionId;
  let acknowledgementMode = "vendor_session";

  if (session.ok) {
    vendorId = clean(session.vendor.vendorId);
  } else {
    const legacyToken = verifyLegacyComplianceAcknowledgementToken(
      body?.acknowledgement_token || body?.legacy_token
    );

    if (!legacyToken) {
      return json(session.status, {
        ok: false,
        error: session.error,
        message:
          "This acknowledgement link expired. Refresh the vendor portal and try again.",
      });
    }

    if (
      suppliedSanctionId &&
      suppliedSanctionId !== legacyToken.sanctionId
    ) {
      return json(400, {
        ok: false,
        error: "SUSPENSION_NOTICE_MISMATCH",
        message: "The suspension notice changed. Refresh and try again.",
      });
    }

    vendorId = legacyToken.vendorId;
    sanctionId = legacyToken.sanctionId;
    acknowledgementMode = "legacy_portal";
  }

  if (!isUuid(vendorId) || !isUuid(sanctionId)) {
    return json(400, {
      ok: false,
      error: "INVALID_SUSPENSION_NOTICE",
      message: "A valid suspension notice is required.",
    });
  }

  const result = await admin.rpc("vendor_acknowledge_suspension_v1", {
    p_vendor_id: vendorId,
    p_sanction_id: sanctionId,
  });

  if (result.error) {
    const raw = clean(result.error.message);
    if (raw.includes("ACTIVE_SUSPENSION_NOT_FOUND")) {
      return json(404, {
        ok: false,
        error: "ACTIVE_SUSPENSION_NOT_FOUND",
        message: "The active suspension notice was not found.",
      });
    }
    return json(500, {
      ok: false,
      error: "SUSPENSION_ACKNOWLEDGEMENT_FAILED",
      message: raw || "The suspension notice could not be acknowledged.",
    });
  }

  return json(200, {
    ok: true,
    acknowledgement_mode: acknowledgementMode,
    result: result.data,
  });
}
