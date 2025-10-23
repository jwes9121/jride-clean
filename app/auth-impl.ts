// app/auth-impl.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Optional: basic “must-be-logged-in” gate for all pages under /(authed)
// returning true allows the request; false redirects to /auth/signin
const authorized = ({ auth }: { auth: any }) => !!auth?.user;

export const {
  handlers: { GET, POST },  // for /api/auth route
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    // This callback lets you add simple route protection if you want
    authorized,
  },
});
