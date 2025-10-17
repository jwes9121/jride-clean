// app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export const runtime = "nodejs"; // IMPORTANT: avoid edge for OAuth

const enableGoogle = process.env.ENABLE_GOOGLE === "1";

const providers = [] as NonNullable<NextAuthOptions["providers"]>;

// Google (prod + dev)
if (enableGoogle && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Safe defaults; 'prompt=consent' ensures refresh token on first grant
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" },
      },
    })
  );
} else if (enableGoogle) {
  // If enabled but missing envs, we still boot—just log
  console.error("[Auth] Google enabled but GOOGLE_CLIENT_ID/SECRET missing.");
}

// Dev-only Credentials (so you can keep building if Google is flaky)
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      name: "Dev Login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(c) {
        const email = (c?.email || "").toString().trim();
        if (!email) return null;
        return { id: "dev-user", name: "Dev User", email };
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/auth/signin", // your custom sign-in page
  },
  session: { strategy: "jwt" },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow relative paths and same-origin absolute URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;

        // (Optional) allow your production domain explicitly
        const prod = process.env.NEXTAUTH_URL;
        if (prod && u.origin === new URL(prod).origin) return url;
      } catch {}
      // Fallback: home
      return baseUrl;
    },
    async jwt({ token, account, profile }) {
      // Attach provider info on first sign in
      if (account?.provider === "google" && profile) {
        token.provider = "google";
        token.email = token.email || (profile as any).email;
        token.name = token.name || (profile as any).name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.provider) (session as any).provider = token.provider;
      return session;
    },
  },
  // Strong logging only when you need it
  debug: process.env.NEXTAUTH_DEBUG === "true",
  // (Optional hardening) trust proxy headers on Vercel (NextAuth reads them automatically)
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
