// lib/supabase-admin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !service) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE");
  }
  _admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
