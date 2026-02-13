// app/auth-impl.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// (Optional) tweak callbacks to put name/email on the session like your UI expects.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.name) token.name = profile.name as string;
      if (profile?.email) token.email = profile.email as string;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = (token.name as string) ?? session.user.name ?? null;
        session.user.email =
          (token.email as string) ?? session.user.email ?? null;
      }
      return session;
    },
  },
});

// default export makes `import auth from "@/app/auth"` work too
export default auth;
