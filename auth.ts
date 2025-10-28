// auth.ts (root of the repo)

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const authOptions = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // We’re using JWT sessions (you already configured this)
  session: {
    strategy: "jwt",
  },

  // Force a stable, secure cookie name so prod cookies don't get weird
  cookies: {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
  },

  // Tell NextAuth “it's safe to trust the incoming host”
  // (your NEXTAUTH_URL is also set in Vercel)
  trustHost: true,

  // MUST have NEXTAUTH_SECRET in prod, and you do ✅
  secret: process.env.NEXTAUTH_SECRET!,
};

// This call to NextAuth(options) RETURNS all the helpers.
const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

// Re-export what the rest of the app / middleware / pages use:
export { auth, signIn, signOut };

// MOST IMPORTANT BIT for v5 + App Router + Vercel:
// We must give Next.js concrete GET/POST handlers to attach to /api/auth/*.
export const GET = handlers.GET;
export const POST = handlers.POST;
