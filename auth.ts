import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Central auth config object that we'll feed to NextAuth()
const authOptions: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Force JWT sessions so we don't need a DB
  session: {
    strategy: "jwt",
  },

  // Stable, secure cookie name/flags for production
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

  // tell NextAuth to trust the host header coming in
  // (and you already have NEXTAUTH_URL in Vercel env)
  trustHost: true,

  // MUST be set in prod, and you do have NEXTAUTH_SECRET in Vercel
  secret: process.env.NEXTAUTH_SECRET!,
};

// Call NextAuth() once with our config. This returns all helpers.
const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

// Re-export what the rest of the app / middleware / pages will import:
export { auth, signIn, signOut };

// Next.js App Router wants concrete GET/POST handlers mounted on /api/auth/*.
// We expose them here, then [...nextauth]/route.ts re-exports them.
export const GET = handlers.GET;
export const POST = handlers.POST;
