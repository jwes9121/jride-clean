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
    // must literally be "jwt" (string) but is valid for NextAuthConfig
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

  // we are deployed behind app.jride.net with NEXTAUTH_URL already set
  trustHost: true,

  secret: process.env.NEXTAUTH_SECRET!,
};

const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

// what the rest of the app/middleware imports
export { auth, signIn, signOut };

// concrete handlers that [...nextauth]/route.ts re-exports
export const GET = handlers.GET;
export const POST = handlers.POST;
