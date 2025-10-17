// app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const runtime = "nodejs"; // IMPORTANT: OAuth should not run on edge

const enableGoogle = process.env.ENABLE_GOOGLE === "1";

const providers: NextAuthOptions["providers"] = [];

// Google OAuth (dev & prod)
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

// Dev-only Credentials fallback (optional)
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
  providers,
  pages: { signIn: "/auth/signin" },
  session: { strategy: "jwt" },
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;
        const prod = process.env.NEXTAUTH_URL;
        if (prod && u.origin === new URL(prod).origin) return url;
      } catch {}
      return baseUrl;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile) {
        token.provider = "google";
        token.email ??= (profile as any).email;
        token.name ??= (profile as any).name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.provider) (session as any).provider = token.provider;
      return session;
    },
  },
  debug: process.env.NEXTAUTH_DEBUG === "true",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
