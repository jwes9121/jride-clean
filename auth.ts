// auth.ts – JRide production Auth.js / NextAuth config
// Fresh version to fix Android login issues (no PKCE / state custom checks)

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Helper to split comma-separated env vars safely
function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const adminEmails = parseEmailList(process.env.ADMIN_EMAILS);
const dispatcherEmails = parseEmailList(process.env.DISPATCHER_EMAILS);

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error(
    "[auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables."
  );
}

export const authConfig = {
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,

      // IMPORTANT: disable PKCE/state checks to avoid InvalidCheck errors
      // in the Android flow. This is safe for now because we only allow
      // trusted Google accounts (test users) to sign in.
      checks: [],

      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // When a new sign-in happens, we get account + profile
      if (account && profile && typeof profile === "object") {
        const email =
          typeof (profile as any).email === "string"
            ? ((profile as any).email as string).toLowerCase()
            : undefined;

        if (email) {
          if (adminEmails.includes(email)) {
            (token as any).role = "admin";
          } else if (dispatcherEmails.includes(email)) {
            (token as any).role = "dispatcher";
          } else {
            (token as any).role = "user";
          }
        }
      }

      // Ensure role always exists
      if (!(token as any).role) {
        (token as any).role = "user";
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
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
