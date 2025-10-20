import NextAuth, { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export type AppRole = "admin" | "dispatcher" | "driver" | "user";

function parseList(v?: string | null) {
  return (v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
const ADMIN = new Set(parseList(process.env.ADMIN_EMAILS));
const DISPATCHER = new Set(parseList(process.env.DISPATCHER_EMAILS));
const DRIVER = new Set(parseList(process.env.DRIVER_EMAILS));

function inferRoleByEmail(email?: string | null): AppRole {
  const e = (email ?? "").toLowerCase();
  if (!e) return "user";
  if (ADMIN.has(e)) return "admin";
  if (DISPATCHER.has(e)) return "dispatcher";
  if (DRIVER.has(e)) return "driver";
  return "user";
}

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
    })
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, trigger, session, account, user }) {
      if (trigger === "signIn" || account || user) {
        token.role = inferRoleByEmail(token.email ?? user?.email ?? null);
      }
      if (trigger === "update" && session?.user?.role) {
        token.role = session.user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) session.user = {};
      session.user.role = (token.role ?? inferRoleByEmail(session.user.email)) as AppRole;
      return session;
    },
    authorized({ auth, request }) {
      const role = auth?.user?.role as AppRole | undefined;
      const { pathname } = request.nextUrl;

      if (
        pathname === "/" ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/landing") ||
        pathname.startsWith("/website") ||
        pathname.startsWith("/offline")
      ) return true;

      if (pathname.startsWith("/admin")) return role === "admin";
      if (pathname.startsWith("/dispatch")) return role === "dispatcher" || role === "admin";
      if (pathname.startsWith("/driver")) return role === "driver" || role === "admin";

      return !!auth?.user;
    }
  },
  secret: process.env.NEXTAUTH_SECRET
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
