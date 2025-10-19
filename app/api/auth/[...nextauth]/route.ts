// app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/** Read a required env var or fail fast */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Explicitly type as NextAuthOptions so TS doesn't confuse it with NextRequest */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: req("GOOGLE_CLIENT_ID"),
      clientSecret: req("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    // Control where users land after Google completes
    async redirect({ url, baseUrl }) {
      // allow relative callbackUrl (e.g. "/admin")
      if (url.startsWith("/")) return url;

      // allow same-origin absolute URLs
      try {
        const u = new URL(url);
        const b = new URL(baseUrl);
        if (u.origin === b.origin) return u.pathname + u.search + u.hash;
      } catch {
        /* ignore parse errors */
      }

      // fallback landing page after sign-in
      return "/admin"; // change if you want a different page
    },
  },
  secret: req("NEXTAUTH_SECRET"),
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
