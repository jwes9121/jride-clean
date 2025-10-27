// auth.config.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * FINAL auth config for production.
 * - Uses Google OAuth
 * - Uses JWT sessions
 * - Adds basic user info to session
 * - Loosens types so build doesn't explode
 * - Patches `session.expires` to satisfy NextAuth expectations
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
    // Called whenever JWT is created or updated
    async jwt(params: any) {
      const { token, account, profile } = params;

      if (account && profile) {
        if (profile.email) {
          token.email = profile.email;
        }
        if (profile.name) {
          token.name = profile.name;
        }

        if (profile.picture) {
          token.picture = profile.picture;
        } else if (profile.avatar_url) {
          token.picture = profile.avatar_url;
        }
      }

      return token;
    },

    // Called whenever session() runs
    async session(params: any) {
      const { session, token } = params;

      if (session.user) {
        if (token.email) session.user.email = token.email;
        if (token.name) session.user.name = token.name;
        if (token.picture) session.user.image = token.picture;
      }

      // NextAuth expects session.expires to exist.
      if (!session.expires) {
        session.expires = new Date(
          Date.now() + 1000 * 60 * 60 * 24
        ).toISOString();
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

// Export NextAuth handlers for App Router
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions as any);
