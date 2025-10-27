import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Optional email allowlist (admin/dispatcher control)
const ALLOWED_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : [];

const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],

  session: {
    strategy: "jwt" as const,
  },

  callbacks: {
    /**
     * Runs whenever the JWT is created or updated.
     * We stash profile fields onto the token.
     */
    async jwt({ token, account, profile }) {
      if (account && profile) {
        if (profile.email) {
          token.email = profile.email as string;
        }
        if (profile.name) {
          token.name = profile.name as string;
        }

        // Google commonly returns `picture`
        const pic =
          (profile as Record<string, any>)?.picture ??
          (profile as Record<string, any>)?.avatar_url ??
          null;
        if (pic) {
          token.picture = pic as string;
        }

        // If you want to block unknown emails in the future, uncomment:
        //
        // if (ALLOWED_EMAILS.length > 0) {
        //   const lowerEmail = String(profile.email || "").toLowerCase();
        //   if (!ALLOWED_EMAILS.includes(lowerEmail)) {
        //     token.denied = true;
        //   }
        // }
      }

      return token;
    },

    /**
     * Runs when we build the session object.
     * We move token fields -> session.user safely (only if defined),
     * to satisfy TypeScript and avoid undefined assignment errors.
     */
    async session({ session, token }) {
      if (session.user) {
        if (token.email) {
          session.user.email = token.email as string;
        }
        if (token.name) {
          session.user.name = token.name as string;
        }
        if (token.picture) {
          session.user.image = token.picture as string;
        }

        // If we used token.denied above, we could surface it:
        // if ((token as any).denied) {
        //   (session as any).denied = true;
        // }
      }

      return session;
    },

    /**
     * Optional gate to allow/block login up front.
     * Uncomment if/when you want to enforce allowlist on sign-in.
     */
    // async signIn({ profile }) {
    //   if (!profile?.email) return false;
    //   if (ALLOWED_EMAILS.length === 0) return true;
    //   const lowerEmail = profile.email.toLowerCase();
    //   return ALLOWED_EMAILS.includes(lowerEmail);
    // },
  },

  // We let NextAuth control its own pages for callbacks.
  // You've already got your own /auth/signin UI.
  // pages: {
  //   signIn: "/auth/signin",
  //   error: "/auth/error",
  // },

  secret: process.env.NEXTAUTH_SECRET,
};

// Export in the App Router style: handlers, auth, signIn, signOut
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
