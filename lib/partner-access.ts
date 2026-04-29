import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function requirePartnerAccess() {
  const session = await auth();
  const user = (session?.user ?? null) as any;

  if (!user) {
    return { ok:false, status:401, error:"UNAUTHORIZED" };
  }

  const email = String(user.email || "").toLowerCase().trim();
  if (!email) {
    return { ok:false, status:403, error:"NO_EMAIL" };
  }

  const supabase = getSupabase();

  const res = await supabase
    .from("partner_user_access")
    .select("*")
    .eq("email", email)
    .eq("is_active", true);

  if (res.error) {
    return { ok:false, status:500, error:res.error.message };
  }

  const rows = Array.isArray(res.data) ? res.data : [];

  if (rows.length === 0) {
    return { ok:false, status:403, error:"NO_PARTNER_ACCESS" };
  }

  return {
    ok:true,
    session,
    user,
    access: rows
  };
}
