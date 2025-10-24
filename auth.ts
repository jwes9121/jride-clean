import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    // Google OAuth (prod + dev)
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // Dev / emergency login.
    // Only works if ENABLE_GOOGLE === "0".
    Credentials({
      name: "Dev Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
      },
      async authorize(
        credentials: Partial<Record<"email", unknown>>,
        _request
      ) {
        // Block credentials login unless we're explicitly allowing it
        if (process.env.ENABLE_GOOGLE !== "0") {
          return null;
        }

        const rawEmail = credentials?.email;
        if (!rawEmail || typeof rawEmail !== "string") {
          return null;
        }

        const user = {
          id: "dev-user",
          name: rawEmail,     // must be string for TS
          email: rawEmail,    // must be string for TS
          role: "admin",      // custom field
        };

        return user as any;
      },
    }),
  ],

  trustHost: true,

  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    async jwt({ token, account, user }) {
      // first login
      if (account && user) {
        token.role = (user as any).role ?? "user";
      }
      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role ?? "user";
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      // allow callbackUrl="/admin/livetrips"
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      // allow same-origin absolute URLs
      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        if (target.origin === base.origin) {
          return url;
        }
      } catch {
        /* ignore */
      }

      // fallback after login
      return `${baseUrl}/`;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
});
