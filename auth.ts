// auth.ts (root of project)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

type Role = "admin" | "dispatcher" | "user";

type RoleToken = {
  email?: string;
  role?: Role;
  [key: string]: any;
};

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const dispatcherEmails = (process.env.DISPATCHER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function computeRole(email?: string): Role {
  if (!email) return "user";
  const lower = email.toLowerCase();
  if (adminEmails.includes(lower)) return "admin";
  if (dispatcherEmails.includes(lower)) return "dispatcher";
  return "user";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // IMPORTANT: disable PKCE to fix Android WebView login
      checks: ["state"],
    }),
  ],
  callbacks: {
    async jwt({ token }) {
      const t = token as RoleToken;
      const email = t.email ?? (t as any).email;
      t.role = computeRole(email as string | undefined);
      return t;
    },
    async session({ session, token }) {
      const t = token as RoleToken;
      if (session.user) {
        (session.user as any).role = t.role ?? "user";
      }
      return session;
    },
  },
});