// auth.ts (root)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Keep it minimal to avoid type churn.
// Ensure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set in env.
export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // optionally: allowDangerousEmailAccountLinking: true,
    }),
  ],
});
