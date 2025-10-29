// auth.ts (or wherever you configure NextAuth v5 / auth.js)
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
// import your DB client (Supabase, Prisma, etc.)

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  trustHost: true,

  callbacks: {
    async session({ session, token }) {
      // session.user.email should exist from Google
      // Now: look up the role from your DB
      // Pseudocode here, adapt based on how you query users:

      // Example using Supabase client / query by email:
      // const { data: rows } = await supabaseAdmin
      //   .from("users")
      //   .select("role")
      //   .eq("email", session.user.email)
      //   .single();

      // For now (until you wire DB), hard-set yourself as admin:
      let role = "user";
      if (session.user?.email === "jwes9121@gmail.com") {
        role = "admin";
      }

      // Attach the role into the session the browser/middleware sees
      return {
        ...session,
        user: {
          ...session.user,
          role,
        },
      };
    },
  },
});
