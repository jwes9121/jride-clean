import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// fail fast if required env is missing
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const authOptions = {
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
  callbacks: {
    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      // Respect relative callbackUrls (e.g. "/profile") when present,
      // but otherwise ALWAYS go to "/"
      if (url?.startsWith("/")) return `${baseUrl}${url}`;
      return `${baseUrl}/`;
    },
  },
} satisfies Parameters<typeof NextAuth>[0];

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
