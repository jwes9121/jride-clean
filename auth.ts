// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // persist login using a signed JWT cookie
  session: {
    strategy: "jwt",
  },

  // required for custom domains on Vercel / multiple hosts
  trustHost: true,

  callbacks: {
    // put profile info onto the token the first time they sign in
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.picture;
      }
      return token;
    },

    // expose that token info on session.user so your UI can read it
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;
        session.user.image = token.picture as string | undefined;
      }
      return session;
    },

    // after successful login, choose where to send them
    redirect({ url, baseUrl }) {
      // if NextAuth is trying to go to a relative path ("/something"), keep it
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }

      // if it's the same origin already, allow it
      if (new URL(url).origin === baseUrl) {
        return url;
      }

      // DEFAULT: send all successful sign-ins to Dispatch dashboard
      return `${baseUrl}/dispatch`;
    },
  },
});
