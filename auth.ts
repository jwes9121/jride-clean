import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const authSetup = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Force JWT session so we don't need a DB
  session: {
    strategy: "jwt",
  },

  // Lock cookie name/flags for production
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

  // Make sure NextAuth trusts the host we told it about in NEXTAUTH_URL
  // and runs on that base.
  trustHost: true, // lets NextAuth accept the host from the incoming request
  // (If needed we could also do: basePath: "/api/auth", but with trustHost + correct NEXTAUTH_URL, it's usually fine.)

  secret: process.env.NEXTAUTH_SECRET,
});

const { handlers, auth, signIn, signOut } = authSetup;

export { auth, signIn, signOut };
export const GET = handlers.GET;
export const POST = handlers.POST;
