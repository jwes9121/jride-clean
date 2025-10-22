// auth.ts (NextAuth v5)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const {
  handlers: { GET, POST },
  auth,        // for server components / API routes
  signIn,      // optional helpers
  signOut
} = NextAuth({
  trustHost: true, // needed on Vercel/custom domains
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  // Keep it simple; let NextAuth manage cookies on host-only domain
  // (no custom cookie domain — avoids cross-subdomain issues)
  callbacks: {
    // Gatekeeping used by middleware below
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;

      // Always allow NextAuth’s own routes
      if (pathname.startsWith("/api/auth")) return true;

      // Public, non-auth pages you want accessible without login:
      const publicPaths = new Set<string>([
        "/", "/website", "/_not-found" // <- edit as you wish
      ]);
      if (publicPaths.has(pathname)) return true;

      // Everything else requires a session
      return !!auth;
    },
  },
  // If you rely on JWT sessions (default), do not set custom session strategy here
  // secret comes from NEXTAUTH_SECRET
});
