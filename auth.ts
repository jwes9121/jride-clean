
// auth.ts (at repo root)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const rawNextAuthUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;

console.log("[JRIDE AUTH] Booting NextAuth with env:", {
  NEXTAUTH_URL: rawNextAuthUrl ?? "NOT_SET",
  AUTH_SECRET_present: !!process.env.AUTH_SECRET,
  NEXTAUTH_SECRET_present: !!process.env.NEXTAUTH_SECRET,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET_present: !!process.env.GOOGLE_CLIENT_SECRET,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  // optional, but fine to leave NextAuth to use NEXTAUTH_URL automatically
});
