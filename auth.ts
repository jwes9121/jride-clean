// auth.ts (root of repo)

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// This is the ONLY source of truth for auth in the app.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required in Vercel/custom domain setups
  trustHost: true,

  // Your providers (Google OAuth)
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // We are fine with the default session/cookie behavior.
  // Do NOT force legacy cookie names.
  // Do NOT override "__Secure-next-auth.session-token".
  // Do NOT manually set session.strategy here unless we have a real reason.
  //
  // NextAuth v5 will default to JWT-style sessions anyway.
  // If you later need callbacks (to inject role, etc.), we'll add them here.
  //
  // callbacks: {
  //   async session({ session, token }) {
  //     // you can enrich session.user here if needed
  //     return session;
  //   },
  // },
  secret: process.env.NEXTAUTH_SECRET!,
});
