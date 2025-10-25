// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // trustHost is important with NextAuth v5 to avoid callback URL weirdness.
  trustHost: true,

  // You can add callbacks here to control redirect after login if you want.
  // For now we’ll just let you through once you're signed in.
});
