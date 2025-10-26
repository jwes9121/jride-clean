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

  // persist session using JWT (no DB required)
  session: {
    strategy: "jwt",
  },

  trustHost: true,

  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;
        session.user.image = token.picture as string | undefined;
      }
      return session;
    },

    // 👇 This is the part that makes redirect work after Google login
    redirect({ url, baseUrl }) {
      // If NextAuth tries to redirect to a relative path, keep it
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow same-origin redirects
      if (new URL(url).origin === baseUrl) return url;
      // Default redirect: /dispatch
      return `${baseUrl}/dispatch`;
    },
  },
});
