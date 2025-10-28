// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const authSetup = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // JWT sessions so we don't need a DB
  session: {
    strategy: "jwt",
  },

  // Secure cookie setup for production on a custom domain
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

  // let NextAuth trust the incoming host (works with NEXTAUTH_URL + custom domain)
  trustHost: true,

  // required
  secret: process.env.NEXTAUTH_SECRET,
});

// unpack what we need
const { handlers, auth, signIn, signOut } = authSetup;

// export helpers for server components/middleware
export { auth, signIn, signOut };

// export route handlers that Next.js will call for /api/auth/*
export const GET = handlers.GET;
export const POST = handlers.POST;
