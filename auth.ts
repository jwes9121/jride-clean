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
    // Google OAuth (real users)
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // Dev / emergency login.
    // This should ONLY work if ENABLE_GOOGLE === "0".
    Credentials({
      name: "Dev Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
      },

      // NextAuth v5 expects (credentials, request) => Awaitable<User | null>
      // We'll satisfy that AND keep role.
      async authorize(
        credentials: Partial<Record<"email", unknown>>,
        _request
      ) {
        // if we're not in dev mode, disable Credentials login completely
        if (process.env.ENABLE_GOOGLE !== "0") {
          return null;
        }

        const rawEmail = credentials?.email;

        if (!rawEmail || typeof rawEmail !== "string") {
          return null;
        }

        // Build a minimal User object with string fields
        const user = {
          id: "dev-user",
          name: rawEmail,     // must be string
          email: rawEmail,    // must be string
          role: "admin",      // our custom field
        };

        // Cast to any so TS stops complaining that "role" isn't in the base User type
        return user as any;
      },
    }),
  ],

  // allow both localhost and production host
  trustHost: true,

  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    // runs whenever we create/update the JWT
    async jwt({ token, account, user }) {
      // first login: attach role from user (dev creds) if present
      if (account && user) {
        token.role = (user as any).role ?? "user";
      }
      return token;
    },

    // controls what goes to the client session
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role ?? "user";
      }
      return session;
    },

    // final redirect after signIn("google", { callbackUrl })
    async redirect({ url, baseUrl }) {
      // if callbackUrl was relative (/admin/livetrips), keep it
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      // if same-origin absolute URL, allow it
      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        if (target.origin === base.origin) {
          return url;
        }
      } catch {
        // ignore bad URLs
      }

      // fallback: send home
      return `${baseUrl}/`;
    },
  },

  // must match NEXTAUTH_SECRET in Vercel
  secret: process.env.NEXTAUTH_SECRET,
});
