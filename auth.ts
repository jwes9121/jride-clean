import NextAuth, { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { inferRoleByEmail, homeFor, type AppRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: AppRole;
    }
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // attach role into the token on sign-in or refresh
    async jwt({ token, trigger, session, account, user }) {
      if (trigger === "signIn" || account || user) {
        token.role = inferRoleByEmail(token.email ?? user?.email ?? null);
      }
      // allow role updates if you ever edit it client-side
      if (trigger === "update" && session?.user?.role) {
        token.role = session.user.role;
      }
      return token;
    },
    // expose role on session.user
    async session({ session, token }) {
      if (!session.user) session.user = {};
      session.user.role = (token.role ?? inferRoleByEmail(session.user.email)) as AppRole;
      return session;
    },
    // centralized redirect logic after sign-in
    async redirect({ url, baseUrl }) {
      try {
        const target = new URL(url, baseUrl);
        // Allow absolute same-origin and relative redirects
        if (target.origin === baseUrl || !target.origin.startsWith("http")) {
          return target.toString();
        }
      } catch {}
      return baseUrl; // fallback
    },
    // route-level authorization; middleware uses this
    authorized({ auth, request }) {
      const role = auth?.user?.role as AppRole | undefined;
      const { pathname } = request.nextUrl;

      // Public
      if (
        pathname === "/" ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/landing") ||
        pathname.startsWith("/website") ||
        pathname.startsWith("/offline")
      ) return true;

      // Role-gated
      if (pathname.startsWith("/admin")) return role === "admin";
      if (pathname.startsWith("/dispatch")) return role === "dispatcher" || role === "admin";
      if (pathname.startsWith("/driver")) return role === "driver" || role === "admin";

      // default: require sign-in
      return !!auth?.user;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  // debug: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
