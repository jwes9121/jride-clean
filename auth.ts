import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// If you want to restrict sign-in to certain emails (like dispatch/admin),
// you can add them in env and uncomment the authorize check below.
const ALLOWED_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(",").map(e => e.trim().toLowerCase())
  : [];

export const authOptions: NextAuthOptions = {
  // We only use Google for now
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],

  // Add JWT strategy so we can read info in middleware / server components
  session: {
    strategy: "jwt",
  },

  callbacks: {
    /**
     * Called whenever a JWT is created/updated.
     * We copy relevant profile info onto the token.
     */
    async jwt({ token, account, profile }) {
      // If this is the first time the user signs in this session
      if (account && profile) {
        // Basic fields we care about
        if (profile.email) {
          token.email = profile.email as string;
        }
        if (profile.name) {
          token.name = profile.name as string;
        }

        // Google sometimes exposes `picture`
        // types don't always include it, so we guard it.
        const pic =
          (profile as Record<string, any>)?.picture ??
          (profile as Record<string, any>)?.avatar_url ??
          null;
        if (pic) {
          token.picture = pic as string;
        }

        // OPTIONAL: email allowlist for admins/dispatch
        // If you want to block anyone not in ALLOWED_EMAILS, you can do:
        //
        // if (ALLOWED_EMAILS.length > 0) {
        //   const lowerEmail = String(profile.email || "").toLowerCase();
        //   if (!ALLOWED_EMAILS.includes(lowerEmail)) {
        //     // We'll "poison" the token so session() can handle it.
        //     token.denied = true;
        //   }
        // }
      }

      return token;
    },

    /**
     * Called whenever `auth()` or `getServerSession()` runs.
     * We move token data onto `session.user`.
     * IMPORTANT: We only assign when values exist so TS doesn't complain
     * about possibly-undefined.
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

        // OPTIONAL: if you used token.denied above, you could expose it:
        // if ((token as any).denied) {
        //   (session as any).denied = true;
        // }
      }

      return session;
    },

    /**
     * (Optional) control sign-in.
     * Return `true` to allow, `false` to block.
     *
     * If you want to restrict access to certain emails, you can uncomment below.
     */
    // async signIn({ profile }) {
    //   if (!profile?.email) return false;
    //   if (ALLOWED_EMAILS.length === 0) return true;
    //   const lowerEmail = profile.email.toLowerCase();
    //   return ALLOWED_EMAILS.includes(lowerEmail);
    // },
  },

  // We’ll keep default pages, but you already have /auth/signin UI.
  // If you ever want to override the error page, etc., you can add:
  // pages: {
  //   signIn: "/auth/signin",
  //   error: "/auth/error",
  // },

  // This is required in production for NextAuth on Vercel.
  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * NextAuth 4.24+ App Router export style:
 *
 * - handlers.GET / handlers.POST are used by /api/auth/[...nextauth]/route.ts
 * - auth() is a helper to read the session server-side
 * - signIn()/signOut() are server actions you can call or link to
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
