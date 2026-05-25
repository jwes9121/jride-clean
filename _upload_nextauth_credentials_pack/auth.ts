import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

function parseEmailList(s?: string | null) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function roleFromEmail(email?: string | null): "admin" | "dispatcher" {
  const e = String(email || "").toLowerCase().trim();

  const admins = parseEmailList(process.env.JRIDE_ADMIN_EMAILS || process.env.ADMIN_EMAILS);
  const dispatchers = parseEmailList(process.env.JRIDE_DISPATCHER_EMAILS || process.env.DISPATCHER_EMAILS);

  // Priority: explicit lists
  if (e && dispatchers.includes(e)) return "dispatcher";
  if (e && admins.includes(e)) return "admin";

  // Default: admin (fail-open to prevent accidental lockout)
  return "admin";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  callbacks: {
    async jwt({ token }) {
      // Attach role based on email allowlists (no DB)
      const email = (token && (token.email as any)) ? String(token.email) : "";
      (token as any).role = roleFromEmail(email);
      return token;
    },

    async session({ session, token }) {
      // Expose role to session.user.role for UI and middleware
      const role = (token as any)?.role || "admin";
      (session as any).user = (session as any).user || {};
      (session as any).user.role = role;
      return session;
    },
  },
});