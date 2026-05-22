import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cleanString(v: any) {
  return String(v ?? "").trim();
}

function normalizeTakeoutTown(value: any): string {
  const raw = cleanString(value).toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

async function selectVendorsSchemaSafe(supabase: any) {
  let cols = ["id", "email", "display_name", "vendor_name", "name", "town", "municipality", "vendor_town", "created_at"];

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await supabase
      .from("vendor_accounts")
      .select(cols.join(","))
      .order("created_at", { ascending: false });

    if (!res.error) return res;

    const msg = String(res.error?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column/i);
    if (m?.[1] && cols.includes(m[1]) && cols.length > 4) {
      cols = cols.filter((c) => c !== m[1]);
      continue;
    }

    return res;
  }

  return { data: null, error: { message: "schema-safe vendor select retries exceeded" } } as any;
}

export async function GET() {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SERVICE_ROLE", message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" },
      { status: 500 }
    );
  }

  const { data, error } = await selectVendorsSchemaSafe(supabase);

  if (error) {
    return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
  }

  const vendors = (Array.isArray(data) ? data : []).map((v: any) => ({
    ...v,
    town: normalizeTakeoutTown(v?.town || v?.municipality || v?.vendor_town),
  }));

  return NextResponse.json({ ok: true, vendors }, { status: 200 });
}