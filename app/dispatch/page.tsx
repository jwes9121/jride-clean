// auth.ts - NextAuth v5 root config for JRide
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const isDevLoginEnabled = process.env.ENABLE_GOOGLE === "0";

const authConfig = {
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: {
    strategy: "jwt" as const,
  },
  providers: [
    Google({
      clientId:
        process.env.GOOGLE_CLIENT_ID ??
        process.env.AUTH_GOOGLE_ID ??
        "",
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET ??
        process.env.AUTH_GOOGLE_SECRET ??
        "",
    }),
    ...(isDevLoginEnabled
      ? [
          Credentials({
            name: "Dev Login",
            credentials: {
              email: { label: "Email", type: "text" },
            },
            async authorize(credentials) {
              if (!credentials?.email) return null;

              return {
                id: "dev-user",
                name: "Dev User",
                email: credentials.email,
              };
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user, account }: any) {
      if (account && user) {
        token.user = {
          id: (user as any).id ?? token.sub,
          name: user.name,
          email: user.email,
        };
      }
      return token;
    },
    async session({ session, token }: any) {
      if (token?.user) {
        (session as any).user = token.user;
      }
      return session;
    },
  },
};

export const {
  auth,
  handlers: { GET, POST },
  signIn,
  signOut,
} = NextAuth(authConfig);
