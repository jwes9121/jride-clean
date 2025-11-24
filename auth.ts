// auth.ts – NextAuth v5 config for JRide

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
// import Credentials from "next-auth/providers/credentials"; // keep commented unless you need it

// Allow both old and new env names so we don't break anything
const googleClientId =
  process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

const authSecret =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

const trustHost =
  process.env.AUTH_TRUST_HOST === "true" ||
  process.env.AUTH_TRUST_HOST === "1" ||
  process.env.AUTH_TRUST_HOST === "yes";

// Optional: list of admin emails, e.g. "jwes9121@gmail.com,other@domain.com"
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

if (!googleClientId || !googleClientSecret) {
  console.warn(
    "[auth.ts] Missing Google client env vars. " +
      "Set AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET."
  );
}

if (!authSecret) {
  console.warn(
    "[auth.ts] Missing AUTH_SECRET / NEXTAUTH_SECRET. Sessions may not work correctly."
  );
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  secret: authSecret || undefined,
  trustHost,

  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),

    // If you want a dev credentials login, uncomment and customize:
    /*
    process.env.NODE_ENV === "development" &&
      Credentials({
        name: "Dev login",
        credentials: {
          email: { label: "Email", type: "text" },
        },
        async authorize(credentials) {
          const email = credentials?.email ?? "dev@example.com";
          return { id: "dev-user", name: "Dev User", email };
        },
      }),
    */
  ].filter(Boolean),

  callbacks: {
    async session({ session }) {
      // Mark admin in the session if email is in ADMIN_EMAILS
      if (
        session.user?.email &&
        adminEmails.includes(session.user.email)
      ) {
        (session.user as any).role = "admin";
      }
      return session;
    },
  },
});
