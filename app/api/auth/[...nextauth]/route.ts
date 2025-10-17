import NextAuth, { type NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const runtime = "nodejs";

const enableGoogle = process.env.ENABLE_GOOGLE === "1";

const providers: NextAuthOptions["providers"] = [];

// Explicitly use env values so no old fallback is picked
if (enableGoogle && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
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

// Optional: dev-only credentials login
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      name: "Dev Login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(c) {
        const email = (c?.email || "").toString().trim();
        if (!email) return null;
        return { id: "dev", name: "Dev User", email };
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,                     // important on Vercel/proxies
  providers,
  pages: { signIn: "/auth/signin" },
  session: { strategy: "jwt" },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
