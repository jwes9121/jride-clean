// lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _serverClient: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (_serverClient) return _serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Defer the error to runtime, not import time
    throw new Error("Missing SUPABASE_URL/SUPABASE_ANON_KEY");
  }

  _serverClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serverClient;
}
