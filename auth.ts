<<<<<<< HEAD
// auth.ts – reset + disable PKCE/state checks for Google

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const adminEmails =
  process.env.ADMIN_EMAILS?.split(",").map((x) => x.trim()) ?? [];
const dispatcherEmails =
  process.env.DISPATCHER_EMAILS?.split(",").map((x) => x.trim()) ?? [];

export const authConfig: NextAuthConfig = {
  // Required on Vercel / custom domains
  trustHost: true,

=======
﻿import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const dispatcherEmails = (process.env.DISPATCHER_EMAILS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,

>>>>>>> 0187e9c (Auth/middleware sync before rebase)
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,

<<<<<<< HEAD
      /**
       * IMPORTANT: turn off PKCE + state checks for Google.
       * This avoids the "InvalidCheck: state value could not be parsed"
       * errors when the Android WebView / in-app browser loses cookies.
       */
      checks: ["none"],
=======
      // 👉 Android fix: disable PKCE + state checks
      checks: [],

      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
>>>>>>> 0187e9c (Auth/middleware sync before rebase)
    }),
  ],

  callbacks: {
<<<<<<< HEAD
    async jwt({ token }) {
      const email = token.email;

      if (email) {
=======
    async jwt({ token, profile }) {
      if (profile?.email) {
        const email = profile.email;

>>>>>>> 0187e9c (Auth/middleware sync before rebase)
        if (adminEmails.includes(email)) {
          (token as any).role = "admin";
        } else if (dispatcherEmails.includes(email)) {
          (token as any).role = "dispatcher";
        } else {
          (token as any).role = "user";
        }
      }
      return token;
    },

<<<<<<< HEAD
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token as any).role ?? "user";
=======
    async session({ session, token }) {
      const role = (token as any).role;
      if (role && session.user) {
        (session.user as any).role = role;
>>>>>>> 0187e9c (Auth/middleware sync before rebase)
      }
      return session;
    },
  },
};

// Export the helpers used by the app + route.ts
export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
