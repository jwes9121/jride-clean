import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

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
    Credentials({
      id: "passenger-credentials",
      name: "Passenger Login",
      credentials: {
        phone: { label: "Phone", type: "text", placeholder: "09XXXXXXXXX or +639XXXXXXXXX" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const phone = String((credentials as any)?.phone || "").trim();
        const password = String((credentials as any)?.password || "").trim();
        if (!phone || !password) return null;

        // Reuse your existing passenger login endpoint to avoid guessing DB schema.
        const baseUrl =
          process.env.NEXTAUTH_URL ||
          process.env.AUTH_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

        const res = await fetch(`${baseUrl}/api/public/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "passenger", phone, password }),
        });

        const j: any = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return null;

        // Flexible mapping
        const u = j?.user || j?.data?.user || j?.profile || j?.passenger || j;
        const id = String(u?.id || u?.user_id || u?.passenger_id || u?.uid || phone);
        const name = String(u?.full_name || u?.name || u?.display_name || phone);
        const email = u?.contact_email || u?.email || undefined;

        return { id, name, email, phone, role: "passenger" } as any;
      },
    }),
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
        async jwt({ token, user, account }) {
      // Passenger credentials login
      if (account?.provider === "passenger-credentials" || account?.provider === "credentials") {
        (token as any).role = "passenger";
        if (user) {
          token.sub = String((user as any).id || token.sub || "");
          (token as any).phone = (user as any).phone || (token as any).phone;
          (token as any).name = (user as any).name || (token as any).name;
        }
        return token;
      }

      // Google-based admin/dispatcher allowlist role
      const email = (token && (token.email as any)) ? String(token.email) : "";
      (token as any).role = roleFromEmail(email);
      return token;
    },

        async session({ session, token }) {
      const role = (token as any)?.role || "admin";
      (session as any).user = (session as any).user || {};
      (session as any).user.role = role;
      (session as any).user.id = String(token?.sub || "");
      if ((token as any)?.phone) (session as any).user.phone = (token as any).phone;
      return session;
    },
  },
});