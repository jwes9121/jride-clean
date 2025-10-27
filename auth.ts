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
    async jwt({
      token,
      account,
      profile,
    }: {
      token: Record<string, any>;
      account?: Record<string, any> | null;
      profile?: Record<string, any> | null;
    }) {
      if (account && profile) {
        if (profile.email) {
          token.email = profile.email as string;
        }
        if (profile.name) {
          token.name = profile.name as string;
        }

        // Google commonly returns `picture`
        const pic =
          profile.picture ??
          profile.avatar_url ??
          null;
        if (pic) {
          token.picture = pic as string;
        }

        // If you want to enforce allowlist, uncomment:
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
     * We move token fields -> session.user safely (only if defined)
     * to satisfy TypeScript and avoid assigning possibly-undefined.
     */
    async session({
      session,
      token,
    }: {
      session: Record<string, any>;
      token: Record<string, any>;
    }) {
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

        // if (token.denied) {
        //   session.denied = true;
        // }
      }

      return session;
    },

    /**
     * Optional: gate login by email.
     * Return true to allow, false to block.
     *
     * You can uncomment this once you're ready to restrict access.
     */
    // async signIn({
    //   profile,
    // }: {
    //   profile?: Record<string, any> | null;
    // }) {
    //   if (!profile?.email) return false;
    //   if (ALLOWED_EMAILS.length === 0) return true;
    //   const lowerEmail = profile.email.toLowerCase();
    //   return ALLOWED_EMAILS.includes(lowerEmail);
    // },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

// Export in App Router style so we can use auth(), signIn(), etc.
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
