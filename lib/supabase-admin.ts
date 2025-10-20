// lib/supabase-admin.ts
import { createClient } from "@supabase/supabase-js";

/** Create the admin client only when called (so build doesn’t explode). */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only

  if (!url || !key) {
    throw new Error("Supabase admin env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
