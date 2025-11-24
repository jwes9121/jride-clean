// auth.ts

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const {
  auth,
  handlers: { GET, POST },
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,

  providers: [
    // Uses AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET automatically
    Google,
  ],

  session: {
    strategy: "jwt",
  },
});
