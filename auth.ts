// Central NextAuth config for both API route + server helpers
// v5 style using next-auth

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// IMPORTANT:
// - NEXTAUTH_SECRET: must be set in Vercel (Production).
// - AUTH_TRUST_HOST=true: already set in your env.
// - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: already set.
//
// We also enable `trustHost` so NextAuth will accept app.jride.net
// as a valid host behind Vercel.

export const {
  handlers,   // { GET, POST }, used by the route handler
  auth,       // server-side session helper
  signIn,     // server action signIn()
  signOut,    // server action signOut()
} = NextAuth({
  providers: [
    Google,
  ],
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});
