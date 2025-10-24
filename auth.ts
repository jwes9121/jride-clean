// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const {
  handlers,          // { GET, POST }
  auth,              // auth(req): session or null
  signIn,
  signOut,
} = NextAuth({
  providers: [
    // Google OAuth
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // OPTIONAL: Dev backdoor login, only if you still want it in prod.
    // If you don't want this in production, set ENABLE_GOOGLE=1 in Vercel.
    Credentials({
      name: "Dev Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
      },
      async authorize(credentials) {
        // Simple dev override
        if (
          process.env.ENABLE_GOOGLE === "0" &&
          credentials?.email
        ) {
          return {
            id: "dev-user",
            name: credentials.email,
            email: credentials.email,
            role: "admin",
          };
        }
        return null;
      },
    }),
  ],

  // we trust both localhost and deployed host
  trustHost: true,

  // this controls where the user ends up after login
  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    // control what goes into the JWT
    async jwt({ token, account, profile, user }) {
      // first time logging in
      if (account && user) {
        token.role = (user as any).role ?? "user";
      }
      return token;
    },

    // control what the client sees as "session"
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role ?? "user";
      }
      return session;
    },

    // after successful sign in, where do we send them?
    async redirect({ url, baseUrl }) {
      // if it's an internal link, keep it
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      // if it's same-origin (app.jride.net or localhost), allow it
      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        if (target.origin === base.origin) {
          return url;
        }
      } catch {
        /* ignore */
      }

      // fallback: send to dashboard/home
      return `${baseUrl}/`;
    },
  },

  // IMPORTANT: You MUST have NEXTAUTH_SECRET set in prod.
  secret: process.env.NEXTAUTH_SECRET,
});
