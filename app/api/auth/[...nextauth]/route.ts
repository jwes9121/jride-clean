// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Fail fast if a required env var is missing.
 */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * NextAuth configuration
 * - No `trustHost` (that option isn’t supported by your installed typings)
 * - Explicit pages and a redirect callback so we land where we want after Google
 */
const authOptions = {
  providers: [
    Google({
      clientId: req("GOOGLE_CLIENT_ID"),
      clientSecret: req("GOOGLE_CLIENT_SECRET"),
    }),
  ],

  // Optional custom pages
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  callbacks: {
    /**
     * Control the final redirect after sign in.
     * - If a callbackUrl is provided and is relative, keep it relative.
     * - If it’s absolute and same-origin, allow it.
     * - Otherwise, send them to your chosen default (change '/admin' if you like).
     */
    async redirect({ url, baseUrl }) {
      try {
        // relative URL (e.g. "/admin")
        if (url.startsWith("/")) return url;

        const u = new URL(url);
        const b = new URL(baseUrl);
        if (u.origin === b.origin) return u.pathname + u.search + u.hash;

        // Fallback
        return "/admin"; // <— change this if you want a different landing page
      } catch {
        return "/admin";
      }
    },
  },

  // Always set NEXTAUTH_URL + NEXTAUTH_SECRET in Vercel env
  secret: req("NEXTAUTH_SECRET"),
} satisfies Parameters<typeof NextAuth>[0];

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
