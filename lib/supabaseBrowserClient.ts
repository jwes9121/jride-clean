"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser-only client for Realtime subscriptions and queries
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
