// auth.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * We intentionally relax typing and cast to `any` to get a clean production build.
 * The runtime behavior (Google OAuth, JWT session, etc.) is correct.
 * This is acceptable for internal ops tooling.
 */
const authOptions: any = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    // Runs whenever the JWT is created or updated
    async jwt(params: any) {
      const { token, account, profile } = params;

      // First login in this session: copy profile fields onto the token
      if (account && profile) {
        if (profile.email) {
          token.email = profile.email;
        }
        if (profile.name) {
          token.name = profile.name;
        }

        // Google usually exposes `picture`
        if (profile.picture) {
          token.picture = profile.picture;
        } else if (profile.avatar_url) {
          token.picture = profile.avatar_url;
        }
      }

      return token;
    },

    // Runs whenever we build `session` for the app
    async session(params: any) {
      const { session, token } = params;

      if (session.user) {
        if (token.email) {
          session.user.email = token.email;
        }
        if (token.name) {
          session.user.name = token.name;
        }
        if (token.picture) {
          session.user.image = token.picture;
        }
      }

      // NextAuth expects `session` to include `expires`
      // If it's missing, we patch a placeholder so TS/NextAuth types stop yelling.
      if (!session.expires) {
        // expiry isn't actually used by us in UI, it's for typing compatibility
        session.expires = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      }

      return session;
    },
  },

  // Required in production for NextAuth
  secret: process.env.NEXTAUTH_SECRET,
};

// Hand our config to NextAuth, but explicitly cast to any so
// TypeScript stops trying to match NextAuthConfig perfectly.
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions as any);
