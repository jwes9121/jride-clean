import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  trustHost: true,
  // debug: true, // enable temporarily if needed
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Relative -> join with base
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Same origin -> allow
      if (new URL(url).origin === baseUrl) return url;
      // Fallback
      return `${baseUrl}/dashboard`;
    },
  },
});
