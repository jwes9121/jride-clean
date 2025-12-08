import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// TEMP DEBUG LOG – local only
console.log("[JRIDE AUTH] Booting NextAuth with env:", {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  AUTH_SECRET_present: Boolean(process.env.AUTH_SECRET),
  NEXTAUTH_SECRET_present: Boolean(process.env.NEXTAUTH_SECRET),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),
});

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
});
