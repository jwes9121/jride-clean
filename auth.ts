import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  trustHost: true,
  callbacks: {
    async redirect({ url, baseUrl }) {
      // If redirect URL is relative, join with baseUrl
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Only allow returning to the same origin
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
});
