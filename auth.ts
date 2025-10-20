import NextAuth, { type NextAuthConfig } from "next-auth";
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

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, trigger, session, account, user }) {
      const t = token as any;
      if (trigger === "signIn" || account || user) {
        t.role = inferRoleByEmail(token.email ?? user?.email ?? null);
      }
      if (trigger === "update" && (session as any)?.user?.role) {
        t.role = (session as any).user.role;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).user = (session as any).user ?? {};
      (session as any).user.role = (token as any).role ?? inferRoleByEmail(session.user?.email);
      return session;
    },
    authorized({ auth, request }) {
      const role = (auth?.user as any)?.role as AppRole | undefined;
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
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
