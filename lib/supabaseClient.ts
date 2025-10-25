export type FakeSupabase = {
  from: (table: string) => {
    select: (cols?: string) => Promise<{ data: any; error: null }>;
    insert: (row: any) => Promise<{ data: any; error: null }>;
    update: (row: any) => {
      eq: (col: string, val: any) => Promise<{ data: any; error: null }>;
    };
  };
};

const supabaseStub: FakeSupabase = {
  from: () => ({
    select: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: (_row: any) => ({
      eq: async () => ({ data: null, error: null }),
    }),
  }),
};

// Export under all the names your code might import.
export const supabase = supabaseStub as any;
export const supabaseBrowserClient = supabaseStub as any;
export const supabaseServerClient = supabaseStub as any;

export default supabaseStub;
