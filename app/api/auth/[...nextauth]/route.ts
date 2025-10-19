// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * IMPORTANT:
 * - Do NOT export "authOptions" from this file (Next.js route type will fail).
 * - Keep only GET/POST exports for the handler.
 * - Remove "trustHost" if your installed next-auth typings complain about it.
 */

function req(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const handler = NextAuth({
  providers: [
    Google({
      clientId: req("GOOGLE_CLIENT_ID"),
      clientSecret: req("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  // If your installed version complains about this line, delete it.
  // trustHost: true,
});

export { handler as GET, handler as POST };
