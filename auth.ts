import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Persist session as a signed JWT cookie instead of relying on a DB.
  session: {
    strategy: "jwt",
  },

  // Allow cookies to be issued on custom domains on Vercel.
  trustHost: true,

  // We’ll also add a very small callback to make sure user is serializable.
  callbacks: {
    async jwt({ token, account, profile }) {
      // On first sign-in, account/profile are defined
      if (account && profile) {
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose token info on session.user
      if (token && session.user) {
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;
        session.user.image = token.picture as string | undefined;
      }
      return session;
    },
  },
});
