// Minimal safe stub to satisfy imports in production build.
// You can replace with real Supabase init later.

export type SupabaseSession = {
  user: {
    id: string;
    email: string | null;
    name?: string | null;
    role?: string | null;
  } | null;
};

export type SupabaseResult<T = any> = {
  data: T | null;
  error: { message: string } | null;
};

function makeStubClient() {
  return {
    auth: {
      // mimic supabase.auth.getSession()
      getSession: async (): Promise<{ data: { session: SupabaseSession } }> => {
        return { data: { session: { user: null } } };
      },
      // mimic supabase.auth.onAuthStateChange()
      onAuthStateChange: (_cb: any) => {
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: (_table: string) => ({
      select: async () => ({ data: null, error: null } as SupabaseResult),
      insert: async () => ({ data: null, error: null } as SupabaseResult),
      update: async () => ({ data: null, error: null } as SupabaseResult),
      upsert: async () => ({ data: null, error: null } as SupabaseResult),
      delete: async () => ({ data: null, error: null } as SupabaseResult),
      eq: function () { return this; },
      order: function () { return this; },
      limit: function () { return this; },
      single: async () => ({ data: null, error: null } as SupabaseResult),
    }),
  };
}

// single stub instance
const stub = makeStubClient();

// Some parts of the app might import different names.
// Export them all so the build never complains.
export const supabase = stub;
export const supabaseClient = stub;
export const supabaseAdmin = stub;
export const supabaseAdminClient = stub;
export default stub;