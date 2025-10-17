import NextAuth, { type NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";

export const runtime = "nodejs";

const providers: NextAuthOptions["providers"] = [];

if (process.env.ENABLE_GOOGLE === "1" &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers,
  pages: { signIn: "/auth/signin" },
  session: { strategy: "jwt" },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
