import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
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

  debug: true,
  logger: {
    error(code, metadata) {
      console.error("NEXTAUTH ERROR:", code, metadata);
    },
    warn(code) {
      console.warn("NEXTAUTH WARN:", code);
    },
    debug(code, metadata) {
      console.log("NEXTAUTH DEBUG:", code, metadata);
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});
