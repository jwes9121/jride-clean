import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Initialize NextAuth with providers + config
const authSetup = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  session: {
    strategy: "jwt",
  },

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

  // NOTE: We intentionally removed `debug` and `logger`
  // because Auth.js v5 expects specific logger signatures
  // and our custom logger was failing type-checking.

  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});

// Extract NextAuth handlers and helpers
const { handlers, auth, signIn, signOut } = authSetup;

// Export helpers for use in middleware, server components, etc.
export { auth, signIn, signOut };

// Export GET and POST so route.ts can re-export them.
// This is what wires up /api/auth/* (signin, callback, etc.) correctly in App Router.
export const GET = handlers.GET;
export const POST = handlers.POST;
