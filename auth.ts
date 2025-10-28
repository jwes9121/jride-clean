import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Initialize NextAuth with providers + config
const authSetup = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  session: {
    strategy: "jwt",
  },

  cookies: {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
  },

  debug: true,
  logger: {
    error(code, metadata) {
      console.error("NEXTAUTH ERROR:", code, metadata);
    },
    warn(code) {
      console.warn("NEXTAUTH WARN:", code);
    },
    debug(code, metadata) {
      console.log("NEXTAUTH DEBUG:", code, metadata);
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});

// authSetup gives us these pieces from NextAuth
const { handlers, auth, signIn, signOut } = authSetup;

// Re-export what the rest of the app needs
export { auth, signIn, signOut };

// Explicitly export GET and POST so the route.ts can just do:
//   export const runtime = "nodejs";
//   export { GET, POST } from "../../../../auth";
// and Next.js/Vercel will route /api/auth/* (signin, callback, error, etc).
export const GET = handlers.GET;
export const POST = handlers.POST;
