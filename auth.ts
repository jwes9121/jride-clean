// auth.ts

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Create ONE NextAuth instance for the entire app
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // important for Vercel/custom domains

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Keep config minimal and default. Do NOT override cookie names.
  // Do NOT manually set session.strategy here unless needed.
  // Do NOT define custom __Secure-next-auth.session-token, etc.
  //
  // This lets NextAuth v5 generate/verify the same JWT session consistently
  // for both the route handler and for auth() in middleware/debug.
  secret: process.env.NEXTAUTH_SECRET!,
});
