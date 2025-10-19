// app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// helper: require an env var
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// DO NOT export this — keep it local to the module
const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: req("GOOGLE_CLIENT_ID"),
      clientSecret: req("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // allow relative callbackUrl or same-origin absolute
      if (url.startsWith("/")) return url;
      try {
        const u = new URL(url);
        const b = new URL(baseUrl);
        if (u.origin === b.origin) return u.pathname + u.search + u.hash;
      } catch {}
      // fallback after sign-in
      return "/admin";
    },
  },
  secret: req("NEXTAUTH_SECRET"),
};

const handler = NextAuth(authOptions);

// Only these are exported
export { handler as GET, handler as POST };
