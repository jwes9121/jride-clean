// app/auth-impl.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Single source of truth for auth.
 * Everything else (app/auth.ts, route handlers) will re-export from here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,

  session: { strategy: "jwt" },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.provider = account.provider;
      }
      if (profile && typeof profile === "object") {
        // Copy a few basics so they're available in the session.
        // Guard with `as any` to avoid typing noise if you don't have a custom Profile type.
        const p = profile as any;
        token.name = p.name ?? token.name;
        token.picture = p.picture ?? token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        (session as any).provider = (token as any).provider;
      }
      return session;
    },
  },
});

export default auth;
