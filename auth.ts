import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const authSetup = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  // Use stateless JWT sessions (no DB required)
  session: {
    strategy: "jwt",
  },

  // Stable secure cookie config for prod
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

  // trustHost lets Auth.js accept the incoming host (app.jride.net)
  // and match it with NEXTAUTH_URL without complaining.
  trustHost: true,

  // must match NEXTAUTH_SECRET in Vercel
  secret: process.env.NEXTAUTH_SECRET,
});

// Destructure what NextAuth gives us
export const { handlers, auth, signIn, signOut } = authSetup;
