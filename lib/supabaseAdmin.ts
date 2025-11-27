Set-Location "C:\Users\jwes9\Desktop\jride-clean-fresh"

@'
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Admin Supabase client for server-side use (API routes, cron, etc.)
 * Uses SERVICE ROLE key – DO NOT expose this in the browser.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is missing (check .env.local)");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (check .env.local)");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
'@ | Set-Content -Encoding UTF8 "lib/supabaseAdmin.ts"
