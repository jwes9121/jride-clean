import { NextRequest, NextResponse } from "next/server";
import { auth, signIn, signOut, handlers } from "../../../../auth";

export async function GET(req: NextRequest) {
  // Try to read the active session using NextAuth v5
  let sessionInfo: any = null;
  let sessionError: any = null;
  try {
    const session = await auth();
    sessionInfo = {
      user: session?.user ?? null,
      expires: session?.expires ?? null,
    };
  } catch (err: any) {
    sessionError = {
      message: err?.message ?? String(err),
      stack: err?.stack ?? null,
    };
  }

  // Inspect headers so we can confirm domain + proto in prod
  const host = req.headers.get("host");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedFor = req.headers.get("x-forwarded-for");
  const cookieHeader = req.headers.get("cookie");

  // Environment sanity
  const envCheck = {
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || null,
    VERCEL_URL: process.env.VERCEL_URL || null,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || null,
    NODE_ENV: process.env.NODE_ENV || null,
  };

  // Confirm what auth.ts is exporting, for sanity
  const exportShape = {
    hasGET: typeof handlers?.GET === "function",
    hasPOST: typeof handlers?.POST === "function",
    hasAuth: typeof auth === "function",
    hasSignIn: typeof signIn === "function",
    hasSignOut: typeof signOut === "function",
  };

  const body = {
    requestInfo: {
      host,
      forwardedHost,
      forwardedProto,
      forwardedFor,
      cookiesPresent: !!cookieHeader,
    },
    sessionInfo,
    sessionError,
    envCheck,
    exportShape,
    hint: [
      "forwardedProto MUST be 'https' in production.",
      "host/forwardedHost MUST be app.jride.net, not *.vercel.app.",
      "cookiesPresent should be true after you log in once.",
      "sessionInfo.user should not be null after successful Google login.",
      "If cookiesPresent=true but sessionInfo.user=null, middleware or cookie domain/path is wrong and causes loops.",
    ],
  };

  return NextResponse.json(body, { status: 200 });
}
