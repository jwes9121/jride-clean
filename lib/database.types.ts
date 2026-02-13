/**
 * Minimal Supabase Database typings placeholder.
 * Replace with generated types when ready, but this unblocks TypeScript.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, unknown>;
    Views: Record<string, unknown>;
    Functions: Record<string, unknown>;
    Enums: Record<string, string | number>;
    CompositeTypes: Record<string, unknown>;
  };
};
