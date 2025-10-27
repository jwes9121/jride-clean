// configs/nextauth.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * Central NextAuth config for both dev and prod.
 * This replaces all older copies like auth.ts / auth.config.ts.
 */

const authOptions: any = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async jwt(params: any) {
      const { token, account, profile } = params;

      // first time login in this browser session
      if (account && profile) {
        if (profile.email) token.email = profile.email;
        if (profile.name) token.name = profile.name;

        if (profile.picture) {
          token.picture = profile.picture;
        } else if (profile.avatar_url) {
          token.picture = profile.avatar_url;
        }
      }

      return token;
    },

    async session(params: any) {
      const { session, token } = params;

      if (session.user) {
        if (token.email) session.user.email = token.email;
        if (token.name) session.user.name = token.name;
        if (token.picture) session.user.image = token.picture;
      }

      // NextAuth requires an 'expires' value
      if (!session.expires) {
        session.expires = new Date(
          Date.now() + 1000 * 60 * 60 * 24 // 24h
        ).toISOString();
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

// Export App Router style helpers (NextAuth v5)
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions as any);
