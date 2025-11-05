import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE!; // server-only (Vercel env)

export function supabaseAdmin() {
  // fresh client per request avoids cross-request leakage
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { headers: { "x-application-name": "jride-admin" } },
  });
}
