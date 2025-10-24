$root = (Get-Location).Path
[System.IO.Directory]::CreateDirectory("$root\app") | Out-Null

$authImpl = @'
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) token.provider = account.provider;
      if (profile && typeof profile === "object") {
        const p = profile as any;
        token.name = p.name ?? token.name;
        token.picture = p.picture ?? token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) (session as any).provider = (token as any).provider;
      return session;
    },
  },
});

export default auth;
'@

# Write with UTF-8 (no BOM)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$root\app\auth-impl.ts", $authImpl, $utf8)
