// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// v4 on Vercel: run on Node runtime (not Edge) and avoid caching
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  // Tell NextAuth it's safe to use the incoming host header on Vercel/custom domains
  trustHost: true,

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  // Optional: make every successful sign-in go to home (or change to the path you prefer)
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Only allow internal redirects
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
});

export { handler as GET, handler as POST };
