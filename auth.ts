// auth.ts - clean NextAuth v5 root config for JRide

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Optional: comma-separated admin emails, e.g.
// ADMIN_EMAILS="you@example.com,other@example.com"
export const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const authConfig: NextAuthConfig = {
  // Required on Vercel / custom domains
  trustHost: true,

  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,

  session: {
    strategy: "jwt",
  },

  providers: [
    Google({
      clientId:
        process.env.GOOGLE_CLIENT_ID ??
        process.env.AUTH_GOOGLE_ID ??
        "",
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET ??
        process.env.AUTH_GOOGLE_SECRET ??
        "",
      // Helps with some older Google app configs
      checks: ["none"],
    }),
  ],

  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        const email = (user.email ?? "").toLowerCase().trim();

        token.user = {
          id: (user as any).id ?? token.sub,
          name: user.name,
          email: user.email,
        };

        if (email && adminEmails.includes(email)) {
          (token as any).isAdmin = true;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token?.user) {
        (session as any).user = token.user;
      }
      if ((token as any).isAdmin) {
        (session as any).isAdmin = true;
      }
      return session;
    },
  },
};

// Create auth/handlers/signIn/signOut in one call
const authHandler = NextAuth(authConfig);

// Named exports for other files
export const { auth, handlers, signIn, signOut } = authHandler;

// Also export GET/POST for API routes that do:
///   export const { GET, POST } = handlers;
export const { GET, POST } = handlers;
