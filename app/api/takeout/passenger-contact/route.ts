import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "../../../../auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ProfileRow = {
  user_id?: string | null;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type AddressRow = {
  address_text?: string | null;
  label?: string | null;
  address?: string | null;
  full_address?: string | null;
  is_primary?: boolean | null;
  updated_at?: string | null;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function phoneFromAuthEmail(email: string | null): string | null {
  const e = clean(email);
  if (!e) return null;
  const m = /^p_(\d+)@phone\.jride\.local$/i.exec(e);
  if (!m) return null;
  const raw = m[1];
  if (raw.startsWith("63")) return "+" + raw;
  return raw;
}

function addressText(row: AddressRow | null): string | null {
  return clean(row?.address_text) || clean(row?.label) || clean(row?.address) || clean(row?.full_address) || null;
}

async function findProfileByUserId(userId: string | null): Promise<ProfileRow | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("passenger_profiles")
    .select("user_id, full_name, phone, email")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as ProfileRow | null) || null;
}

async function findProfileByEmail(email: string | null): Promise<ProfileRow | null> {
  if (!email) return null;
  const { data } = await supabase
    .from("passenger_profiles")
    .select("user_id, full_name, phone, email")
    .eq("email", email)
    .maybeSingle();
  return (data as ProfileRow | null) || null;
}

async function findProfileByPhone(phone: string | null): Promise<ProfileRow | null> {
  if (!phone) return null;
  const { data } = await supabase
    .from("passenger_profiles")
    .select("user_id, full_name, phone, email")
    .eq("phone", phone)
    .maybeSingle();
  return (data as ProfileRow | null) || null;
}

async function findPrimaryAddress(userId: string | null): Promise<string | null> {
  if (!userId) return null;

  const attempts = [
    { key: "user_id", value: userId },
    { key: "passenger_id", value: userId }
  ];

  for (const a of attempts) {
    const primary = await supabase
      .from("passenger_addresses")
      .select("*")
      .eq(a.key, a.value)
      .eq("is_primary", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const primaryText = addressText(primary.data as AddressRow | null);
    if (primaryText) return primaryText;

    const latest = await supabase
      .from("passenger_addresses")
      .select("*")
      .eq(a.key, a.value)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestText = addressText(latest.data as AddressRow | null);
    if (latestText) return latestText;
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    let userId: string | null = null;
    let userEmail: string | null = null;
    let userPhone: string | null = null;
    let meta: Record<string, unknown> = {};
    let authMode: "bearer" | "nextauth" | "none" = "none";

    if (bearerToken) {
      const { data, error } = await supabase.auth.getUser(bearerToken);
      const user = data?.user || null;
      if (!error && user) {
        userId = clean(user.id);
        userEmail = clean(user.email);
        meta = (user.user_metadata || {}) as Record<string, unknown>;
        userPhone = clean(meta.phone) || phoneFromAuthEmail(userEmail);
        authMode = "bearer";
      }
    }

    if (!userId && !userEmail) {
      const session = await auth();
      const sessionUser = (session as any)?.user || null;
      if (sessionUser) {
        userId = clean(sessionUser.id);
        userEmail = clean(sessionUser.email);
        userPhone = clean(sessionUser.phone) || phoneFromAuthEmail(userEmail);
        meta = {
          full_name: sessionUser.full_name,
          name: sessionUser.name,
          phone: sessionUser.phone,
          mobile: sessionUser.mobile,
          address: sessionUser.address
        };
        authMode = "nextauth";
      }
    }

    if (!userId && !userEmail && !userPhone) {
      return NextResponse.json({ ok: false, signed_in: false, reason: "not_authenticated" });
    }

    let profile = await findProfileByUserId(userId);
    if (!profile) profile = await findProfileByPhone(userPhone);
    if (!profile) profile = await findProfileByEmail(userEmail);

    const resolvedUserId = clean(profile?.user_id) || userId;
    const defaultAddress =
      (await findPrimaryAddress(resolvedUserId)) ||
      clean(meta.address) ||
      null;

    const fullName =
      clean(profile?.full_name) ||
      clean(meta.full_name) ||
      clean(meta.name) ||
      null;

    const phone =
      clean(profile?.phone) ||
      clean(userPhone) ||
      clean(meta.phone) ||
      clean(meta.mobile) ||
      null;

    const email =
      clean(profile?.email) ||
      clean(userEmail) ||
      null;

    return NextResponse.json({
      ok: true,
      signed_in: true,
      auth_mode: authMode,
      user_id: userId,
      profile_user_id: clean(profile?.user_id),
      full_name: fullName,
      name: fullName,
      phone,
      email,
      default_address: defaultAddress,
      address: defaultAddress,
      address_text: defaultAddress,
      has_complete_contact: Boolean(fullName && phone),
      source: profile && (profile.full_name || profile.phone) ? "passenger_profiles" : "auth_metadata"
    });
  } catch (error) {
    console.error("takeout passenger-contact error", error);
    return NextResponse.json({ ok: false, signed_in: false, reason: "server_error" }, { status: 500 });
  }
}
