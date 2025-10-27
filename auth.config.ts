// auth.config.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

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
    async jwt(params: any) {
      const { token, account, profile } = params;

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

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions as any);
