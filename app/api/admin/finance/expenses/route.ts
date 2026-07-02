import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createManualExpenseFinanceEvent } from "@/lib/finance/createExpenseEvent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function isInList(val: string | null | undefined, list: string[]) {
  const v = String(val || "").trim();
  return !!v && list.includes(v);
}

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && listLower.includes(e);
}

async function isRequesterAdmin(adminSb: any, userId: string, email: string) {
  const adminIds = parseCsv(env("ADMIN_USER_IDS") || env("JRIDE_ADMIN_USER_IDS"));
  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));

  if (isInList(userId, adminIds)) return true;
  if (isEmailInList(email, adminEmailsLower)) return true;

  try {
    const u = await adminSb.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    if (md?.is_admin === true) return true;
    if (role === "admin") return true;
  } catch {}

  return false;
}

function json(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getAuthedAdmin() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_KEY");
  const service = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE") || env("SUPABASE_SERVICE_KEY");

  if (!url || !anon || !service) {
    return { ok: false as const, response: json(500, { ok: false, error: "SERVER_MISCONFIG" }) };
  }

  const cookieStore = cookies();
  const userSb = createServerClient(url, anon, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const { data } = await userSb.auth.getUser();
  const requesterId = data?.user?.id ? String(data.user.id) : "";
  const requesterEmail = data?.user?.email ? String(data.user.email) : "";

  if (!requesterId) {
    return { ok: false as const, response: json(401, { ok: false, error: "NOT_SIGNED_IN" }) };
  }

  const adminSb = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const okAdmin = await isRequesterAdmin(adminSb, requesterId, requesterEmail);
  if (!okAdmin) {
    return { ok: false as const, response: json(403, { ok: false, error: "FORBIDDEN" }) };
  }

  return { ok: true as const, adminSb, requesterId, requesterEmail };
}

export async function GET() {
  try {
    const gate = await getAuthedAdmin();
    if (!gate.ok) return gate.response;

    const companyRes = await gate.adminSb
      .from("finance_company_profiles")
      .select("id,legal_name,trade_name")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (companyRes.error || !companyRes.data) {
      return json(500, { ok: false, error: "COMPANY_PROFILE_NOT_FOUND", message: companyRes.error?.message || null });
    }

    const companyId = companyRes.data.id;

    const [businessUnitsRes, locationsRes, categoriesRes, taxCodesRes] = await Promise.all([
      gate.adminSb
        .from("core_business_units")
        .select("id,code,name,business_unit_type,status")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      gate.adminSb
        .from("core_locations")
        .select("id,code,name,location_type,parent_location_id")
        .order("name", { ascending: true }),
      gate.adminSb
        .from("finance_categories")
        .select("id,category_type,category_name,account_id")
        .eq("company_id", companyId)
        .eq("category_type", "expense")
        .order("category_name", { ascending: true }),
      gate.adminSb
        .from("finance_tax_codes")
        .select("id,code,name,tax_code_type,is_active")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("code", { ascending: true }),
    ]);

    return json(200, {
      ok: true,
      company: companyRes.data,
      business_units: businessUnitsRes.error ? [] : businessUnitsRes.data || [],
      locations: locationsRes.error ? [] : locationsRes.data || [],
      categories: categoriesRes.error ? [] : categoriesRes.data || [],
      tax_codes: taxCodesRes.error ? [] : taxCodesRes.data || [],
      warnings: {
        business_units: businessUnitsRes.error?.message || null,
        locations: locationsRes.error?.message || null,
        categories: categoriesRes.error?.message || null,
        tax_codes: taxCodesRes.error?.message || null,
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e || "error") });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await getAuthedAdmin();
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));

    const companyId = String(body?.company_id || "").trim();
    const businessUnitId = String(body?.business_unit_id || "").trim() || null;
    const locationId = String(body?.location_id || "").trim() || null;
    const expenseDate = String(body?.expense_date || "").trim();
    const categoryId = String(body?.category_id || "").trim() || null;
    const categoryName = String(body?.category_name || "").trim() || null;
    const description = String(body?.description || "").trim();
    const amount = Number(body?.amount || 0);
    const taxCodeId = String(body?.tax_code_id || "").trim() || null;
    const notes = String(body?.notes || "").trim() || null;

    const result = await createManualExpenseFinanceEvent({
      adminSb: gate.adminSb,
      companyId,
      businessUnitId,
      locationId,
      createdBy: gate.requesterId,
      expenseDate,
      categoryId,
      categoryName,
      description,
      amount,
      taxCodeId,
      notes,
    });

    if (!result.ok) {
      return json(400, result);
    }

    return json(201, result);
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e || "error") });
  }
}
