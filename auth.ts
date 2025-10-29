import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const authOptions: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  session: {
    strategy: "jwt",
  },

  cookies: {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
  },

  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET!,
};

const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

export { auth, signIn, signOut };

export const GET = handlers.GET;
export const POST = handlers.POST;
