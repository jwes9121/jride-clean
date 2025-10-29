// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // this is required in prod on Vercel custom domain
  trustHost: true,

  callbacks: {
    // This runs whenever NextAuth builds the session object that
    // ends up returned by /api/auth/session and used by middleware.
    async session({ session, token, user }) {
      // default role
      let role = "user";

      // TEMP: hardcode you as admin
      if (session?.user?.email === "jwes9121@gmail.com") {
        role = "admin";
      }

      return {
        ...session,
        user: {
          ...session.user,
          role,
        },
      };
    },
  },
});
