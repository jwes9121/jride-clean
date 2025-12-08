import { createClient as supabaseCreateClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using SERVICE ROLE key.
 * Never import this into client components.
 */

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
}

/**
 * Low-level factory if you want the raw Supabase client.
 */
export function supabaseServerClient() {
  return supabaseCreateClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Some routes expect `createClient` from "@/utils/supabase/server".
 * Re-export with that name so those imports keep working.
 */
export const createClient = supabaseServerClient;
