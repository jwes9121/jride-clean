import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

function reqEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: reqEnv("GOOGLE_CLIENT_ID"),
      clientSecret: reqEnv("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  session: { strategy: "jwt" },
  secret: reqEnv("NEXTAUTH_SECRET"),
  debug: true,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
