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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    Credentials({
      name: "Dev Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
      },
      async authorize(credentials, _request) {
        // Only allow this path in fallback/dev mode
        if (process.env.ENABLE_GOOGLE !== "0") {
          return null;
        }

        const rawEmail = credentials?.email;
        if (!rawEmail || typeof rawEmail !== "string") {
          return null;
        }

        return {
          id: "dev-user",
          name: rawEmail,
          email: rawEmail,
          role: "admin",
        } as any;
      },
    }),
  ],

  trustHost: true,

  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    async jwt({ token, account, user }) {
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
      // allow relative callbackUrl like /admin/livetrips
      if (url.startsWith("/")) {
        return baseUrl + url;
      }

      // allow same-origin absolute URLs
      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        if (target.origin === base.origin) {
          return url;
        }
      } catch {
        // ignore parse errors
      }

      // default after signin
      return baseUrl + "/";
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
});
