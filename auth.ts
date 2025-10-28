import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const authSetup = NextAuth({
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
});

export const { handlers, auth, signIn, signOut } = authSetup;

// These MUST be exported so route.ts can re-export them.
export const GET = handlers.GET;
export const POST = handlers.POST;
