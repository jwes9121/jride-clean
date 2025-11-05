import { createClient } from "@supabase/supabase-js";

/** Server-only Supabase admin client */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE(_KEY)");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-application-name": "jride-admin" } },
  });
}
