// auth.ts (root of project)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Read admin / dispatcher emails from env so we can attach a role
 */
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const dispatcherEmails = (process.env.DISPATCHER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required on Vercel / custom domains
  trustHost: true,

  session: {
    strategy: "jwt",
  },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,

      /**
       * IMPORTANT: disable PKCE for Google so Android WebView
       * logins don’t hit "pkceCodeVerifier could not be parsed".
       * This keeps only the "state" check.
       */
      checks: ["state"],
    }),
  ],

  callbacks: {
    async jwt({ token }) {
      if (!token?.email) return token;

      const email = String(token.email).toLowerCase();

      if (adminEmails.includes(email)) {
        // @ts-expect-error – custom field
        token.role = "admin";
      } else if (dispatcherEmails.includes(email)) {
        // @ts-expect-error – custom field
        token.role = "dispatcher";
      } else {
        // @ts-expect-error – custom field
        token.role = "user";
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        // @ts-expect-error – custom field
        session.user.role = token.role ?? "user";
      }
      return session;
    },
  },
});