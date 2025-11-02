// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Optional safety fallback so you never lock yourself out
 * (kept only if the DB doesn't have a row for you yet).
 * You can remove this later once user_roles is populated.
 */
const FALLBACK_ADMINS = new Set<string>(["jwes9121@gmail.com"]);
const FALLBACK_DISPATCHERS = new Set<string>([]); // add if needed

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Required for custom domains on Vercel / proxies
  trustHost: true,

  callbacks: {
    /**
     * Attach `role` to the session so middleware and UI can use it.
     * Order of precedence:
     *   1) role from `user_roles` table (email primary key)
     *   2) fallback allowlists above (so you can't get locked out)
     *   3) default "user"
     */
    async session({ session }) {
      let role: "admin" | "dispatcher" | "user" = "user";
      const email = session.user?.email?.toLowerCase() ?? "";

      if (email) {
        try {
          const sb = supabaseAdmin();
          const { data, error } = await sb
            .from("user_roles")
            .select("role")
            .eq("email", email)
            .maybeSingle();

          if (error) {
            // If the DB read fails, we still allow fallbacks below
            console.warn("[auth.session] user_roles read error:", error.message);
          }

          if (data?.role === "admin" || data?.role === "dispatcher" || data?.role === "user") {
            role = data.role as typeof role;
          } else {
            // Fallback allowlists (safe default)
            if (FALLBACK_ADMINS.has(email)) role = "admin";
            else if (FALLBACK_DISPATCHERS.has(email)) role = "dispatcher";
          }
        } catch (e: any) {
          console.warn("[auth.session] user_roles exception:", e?.message || e);
          // Last-resort fallback
          if (FALLBACK_ADMINS.has(email)) role = "admin";
          else if (FALLBACK_DISPATCHERS.has(email)) role = "dispatcher";
        }
      }

      return {
        ...session,
        user: {
          ...session.user,
          role, // <-- visible at /api/auth/session and in middleware
        },
      };
    },
  },
});
