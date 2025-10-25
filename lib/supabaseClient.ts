// Minimal safe stub to satisfy imports in production build.
// You can replace this with real Supabase client initialization later.

export type SupabaseSession = {
  user: {
    id: string;
    email: string | null;
    name?: string | null;
    role?: string | null;
  } | null;
};

export type SupabaseResult<T = any> = {
  data: T;
  error: { message: string } | null;
};

// This creates an object that pretends to be a Supabase client.
// Every method returns a predictable structure so our app code doesn\'t crash.
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

    // pretend query builder
    from(_table: string) {
      // Return an object that has select/insert/update/etc,
      // each returning { data, error } with data as [] by default.
      return {
        // allow .select("*") or .select("col1,col2") etc
        async select(_cols?: string): Promise<SupabaseResult<any[]>> {
          return { data: [], error: null };
        },

        async insert(_rows?: any): Promise<SupabaseResult<any[]>> {
          return { data: [], error: null };
        },

        async update(_vals?: any): Promise<SupabaseResult<any[]>> {
          return { data: [], error: null };
        },

        async upsert(_vals?: any): Promise<SupabaseResult<any[]>> {
          return { data: [], error: null };
        },

        async delete(): Promise<SupabaseResult<any[]>> {
          return { data: [], error: null };
        },

        // chain helpers like .eq("col", val).order(...).limit(...)
        eq(_col: string, _val: any) {
          return this;
        },

        order(_col: string, _opts?: any) {
          return this;
        },

        limit(_n: number) {
          return this;
        },

        async single(): Promise<SupabaseResult<any>> {
          return { data: null, error: null };
        },
      };
    },
  };
}

// single shared stub instance
const stub = makeStubClient();

// export under multiple names so all imports in the repo resolve
export const supabase = stub;
export const supabaseClient = stub;
export const supabaseAdmin = stub;
export const supabaseAdminClient = stub;

export default stub;