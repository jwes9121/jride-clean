import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const {
  handlers,  // { GET, POST } for the route handler
  auth,      // helper to read the session in middleware / server
  signIn,
  signOut,
} = NextAuth({
  providers: [
    // Google for real users (prod + dev)
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // Optional dev backdoor.
    // If you DON'T want manual email login in prod, set ENABLE_GOOGLE=1 in Vercel.
    Credentials({
      name: "Dev Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
      },
      async authorize(credentials) {
        // Only allow this path if ENABLE_GOOGLE === "0"
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

        // Otherwise block
        return null;
      },
    }),
  ],

  trustHost: true,

  // custom sign-in page
  pages: {
    signIn: "/auth/signin",
  },

  callbacks: {
    // Adds extra fields into the token at login time
    async jwt({ token, account, user }) {
      // first login: attach role
      if (account && user) {
        token.role = (user as any).role ?? "user";
      }
      return token;
    },

    // Controls what the client sees in `useSession()`
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role ?? "user";
      }
      return session;
    },

    // Final redirect after login / signIn()
    async redirect({ url, baseUrl }) {
      // allow relative callbackUrl like /admin/livetrips
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      // allow same-origin absolute URLs
      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        if (target.origin === base.origin) {
          return url;
        }
      } catch {
        /* ignore bad URLs */
      }

      // fallback after login
      return `${baseUrl}/`;
    },
  },

  // must match NEXTAUTH_SECRET in Vercel env
  secret: process.env.NEXTAUTH_SECRET,
});
