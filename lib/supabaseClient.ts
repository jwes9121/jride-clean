// TEMP STUB FOR BUILD
// TODO: replace with real Supabase client for production logic

// Fake types to satisfy callers
export type FakeSupabase = {
  from: (table: string) => {
    select: (cols?: string) => Promise<{ data: any; error: null }>;
    insert: (row: any) => Promise<{ data: any; error: null }>;
    update: (row: any) => {
      eq: (col: string, val: any) => Promise<{ data: any; error: null }>;
    };
  };
};

// extremely dumb no-op client (prevents runtime crashes on server components that import it)
const supabaseStub: FakeSupabase = {
  from: () => ({
    select: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: (_row: any) => ({
      eq: async () => ({ data: null, error: null }),
    }),
  }),
};

// named export clients some code might expect
export const supabaseBrowserClient = supabaseStub as any;
export const supabaseServerClient = supabaseStub as any;

// default export if something imports default
export default supabaseStub;
