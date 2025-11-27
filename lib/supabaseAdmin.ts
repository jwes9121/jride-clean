import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Admin Supabase client for server-side use (API routes, cron, etc.).
 * Uses SERVICE ROLE key – DO NOT expose this in the browser.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is missing (check env vars)");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (check env vars)");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
