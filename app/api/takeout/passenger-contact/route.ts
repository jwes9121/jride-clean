import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ProfileHit = {
  source_table: string;
  source_column: string;
  id?: string | null;
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  passenger_name?: string | null;
  name?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  mobile?: string | null;
  mobile_number?: string | null;
  contact_number?: string | null;
  default_address?: string | null;
  address_text?: string | null;
  address?: string | null;
  is_verified?: boolean | null;
  verified?: boolean | null;
  status?: string | null;
};

function s(v: any): string {
  return String(v ?? "").trim();
}

function pickName(row: any): string {
  return s(row?.full_name || row?.passenger_name || row?.passengerName || row?.name || row?.legal_name || row?.customer_name);
}

function pickPhone(row: any): string {
  return s(row?.phone || row?.phone_number || row?.phoneNumber || row?.mobile || row?.mobile_number || row?.mobileNumber || row?.contact_number || row?.contactNumber);
}

function pickAddress(row: any): string {
  return s(row?.default_address || row?.defaultAddress || row?.address_text || row?.addressText || row?.address || row?.home_address || row?.homeAddress);
}

function normalizeHit(table: string, column: string, row: any): ProfileHit | null {
  if (!row || typeof row !== "object") return null;

  const name = pickName(row);
  const phone = pickPhone(row);
  const address = pickAddress(row);

  if (!name && !phone && !address) return null;

  return {
    source_table: table,
    source_column: column,
    id: row.id ?? row.uuid ?? null,
    user_id: row.user_id ?? row.auth_user_id ?? row.passenger_id ?? null,
    email: row.email ?? row.passenger_email ?? null,
    full_name: name || null,
    passenger_name: row.passenger_name ?? row.passengerName ?? null,
    name: name || null,
    phone: phone || null,
    phone_number: (row.phone_number ?? row.phoneNumber ?? phone) || null,
    mobile: row.mobile ?? null,
    mobile_number: row.mobile_number ?? row.mobileNumber ?? null,
    contact_number: row.contact_number ?? row.contactNumber ?? null,
    default_address: address || null,
    address_text: (row.address_text ?? row.addressText ?? address) || null,
    address: row.address ?? null,
    is_verified: row.is_verified ?? null,
    verified: row.verified ?? null,
    status: row.status ?? row.verification_status ?? null,
  };
}

async function tryOne(table: string, column: string, value: string): Promise<ProfileHit | null> {
  if (!value) return null;
  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(column, value)
      .limit(1);

    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    return normalizeHit(table, column, row);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session: any = await auth().catch(() => null);
    const user = session?.user || null;
    const userId = s(user?.id || user?.sub);
    const email = s(user?.email).toLowerCase();

    if (!userId && !email) {
      return NextResponse.json({ ok: true, signed_in: false, profile: null }, { status: 200 });
    }

    const tables = [
      "passenger_profiles",
      "passenger_profile",
      "passenger_verifications",
      "passenger_verification",
      "passengers",
      "profiles",
      "users",
    ];

    const idColumns = ["user_id", "auth_user_id", "passenger_id", "id", "uuid"];
    const emailColumns = ["email", "passenger_email"];

    for (const table of tables) {
      for (const column of idColumns) {
        const hit = await tryOne(table, column, userId);
        if (hit) return NextResponse.json({ ok: true, signed_in: true, profile: hit }, { status: 200 });
      }
      for (const column of emailColumns) {
        const hit = await tryOne(table, column, email);
        if (hit) return NextResponse.json({ ok: true, signed_in: true, profile: hit }, { status: 200 });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        signed_in: true,
        profile: null,
        warning: "SIGNED_IN_BUT_PASSENGER_CONTACT_NOT_FOUND",
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, signed_in: false, profile: null, error: "PASSENGER_CONTACT_LOOKUP_FAILED", message: err?.message || "Unexpected error" },
      { status: 200 }
    );
  }
}
