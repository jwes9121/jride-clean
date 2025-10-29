import { NextResponse } from "next/server";
import * as AuthModule from "../../../../auth";

export const runtime = "nodejs";

export async function GET() {
  // What does Vercel think our auth exports are?
  const hasGET = typeof (AuthModule as any).GET === "function";
  const hasPOST = typeof (AuthModule as any).POST === "function";
  const hasAuth = typeof (AuthModule as any).auth === "function";
  const hasSignIn = typeof (AuthModule as any).signIn === "function";
  const hasSignOut = typeof (AuthModule as any).signOut === "function";

  // Try to stringify the authOptions indirectly by checking cookie/session config shape.
  // If NextAuth v5 config isn't the one we're expecting, these flags will look different.
  const guessConfig = {
    sessionStrategyLooksLike:
      (AuthModule as any).authOptions?.session?.strategy ??
      (AuthModule as any).authOptions?.session?.[ "strategy" ],
    cookieName:
      (AuthModule as any).authOptions?.cookies?.sessionToken?.name,
  };

  // Env visibility (booleans only, not secrets)
  const envCheck = {
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || null,
  };

  // Return JSON so we can read it in the browser
  return NextResponse.json({
    exports: {
      hasGET,
      hasPOST,
      hasAuth,
      hasSignIn,
      hasSignOut,
    },
    guessConfig,
    envCheck,
    note: "If hasGET=false or hasPOST=false, route.ts will 100% break /api/auth/signin/google.",
  });
}
