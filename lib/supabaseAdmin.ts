// lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client that uses the SERVICE ROLE key.
 * Never import this in client components.
 */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE!;
  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
