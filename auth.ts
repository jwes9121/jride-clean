// auth.ts – reset + disable PKCE/state checks for Google

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const adminEmails =
  process.env.ADMIN_EMAILS?.split(",").map((x) => x.trim()) ?? [];
const dispatcherEmails =
  process.env.DISPATCHER_EMAILS?.split(",").map((x) => x.trim()) ?? [];

export const authConfig: NextAuthConfig = {
  // Required on Vercel / custom domains
  trustHost: true,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,

      /**
       * IMPORTANT: turn off PKCE + state checks for Google.
       * This avoids the "InvalidCheck: state value could not be parsed"
       * errors when the Android WebView / in-app browser loses cookies.
       */
      checks: ["none"],
    }),
  ],

  callbacks: {
    async jwt({ token }) {
      const email = token.email;

      if (email) {
        if (adminEmails.includes(email)) {
          (token as any).role = "admin";
        } else if (dispatcherEmails.includes(email)) {
          (token as any).role = "dispatcher";
        } else {
          (token as any).role = "user";
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token as any).role ?? "user";
      }
      return session;
    },
  },
};

// Export the helpers used by the app + route.ts
export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
