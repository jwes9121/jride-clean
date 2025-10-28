// NextAuth v5 config (explicit Google credentials)

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const {
  handlers,   // { GET, POST }
  auth,       // server session helper
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});
