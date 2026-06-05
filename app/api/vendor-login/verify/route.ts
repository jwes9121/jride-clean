import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function clean(v: any): string {
  return String(v ?? "").trim();
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicVendor(row: any) {
  return {
    vendor_id: clean(row?.vendor_id),
    vendor_name: clean(row?.vendor_name),
    display_name: clean(row?.vendor_name),
    town: clean(row?.town),
    phone: clean(row?.phone),
    status: clean(row?.status),
  };
}

export async function GET() {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role configuration.",
    });
  }

  try {
    const q = await admin
      .from("vendor_onboarding_credentials")
      .select("vendor_id,vendor_name,town,phone,status")
      .eq("status", "pilot_lagawe")
      .order("vendor_name", { ascending: true });

    if (q.error) {
      return json(500, { ok: false, error: "DB_ERROR", message: q.error.message });
    }

    return json(200, {
      ok: true,
      vendors: (Array.isArray(q.data) ? q.data : []).map(publicVendor),
    });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role configuration.",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const selectedVendorId = clean(body?.selected_vendor_id || body?.selectedVendorId);
  const vendorId = clean(body?.vendor_id || body?.vendorId);
  const accessPin = clean(body?.access_pin || body?.pin || body?.vendor_access_pin);

  if (!selectedVendorId) {
    return json(400, { ok: false, error: "MISSING_SELECTED_VENDOR", message: "Select your vendor name first." });
  }

  if (!vendorId) {
    return json(400, { ok: false, error: "MISSING_VENDOR_ID", message: "Enter your vendor UUID." });
  }

  if (selectedVendorId !== vendorId) {
    return json(401, { ok: false, error: "VENDOR_MISMATCH", message: "Selected vendor and entered UUID do not match." });
  }

  if (!/^\d{6}$/.test(accessPin)) {
    return json(400, { ok: false, error: "INVALID_PIN", message: "Enter the 6-digit vendor access code." });
  }

  try {
    const q = await admin
      .from("vendor_onboarding_credentials")
      .select("vendor_id,vendor_name,access_pin,town,phone,status")
      .eq("vendor_id", vendorId)
      .limit(1)
      .maybeSingle();

    if (q.error) {
      return json(500, { ok: false, error: "DB_ERROR", message: q.error.message });
    }

    const row = q.data;
    if (!row) {
      return json(401, { ok: false, error: "VENDOR_NOT_FOUND", message: "Vendor is not registered for onboarding." });
    }

    if (clean(row.access_pin) !== accessPin) {
      return json(401, { ok: false, error: "PIN_MISMATCH", message: "Vendor access code is incorrect." });
    }

    return json(200, {
      ok: true,
      vendor_id: clean(row.vendor_id),
      vendor: publicVendor(row),
    });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
