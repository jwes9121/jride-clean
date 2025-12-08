import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const authOptions = {
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authOptions);

// Make sure these are real named exports
export const GET = handlers.GET;
export const POST = handlers.POST;
