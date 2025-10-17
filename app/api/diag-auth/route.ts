export const runtime = "nodejs";

export async function GET() {
  // NEVER leave this in production long-term; remove after debugging.
  const body = {
    nodeEnv: process.env.NODE_ENV,
    vercel: {
      url: process.env.VERCEL_URL,
      env: process.env.VERCEL_ENV,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    },
    nextauth: {
      url: process.env.NEXTAUTH_URL,
      secretSet: Boolean(process.env.NEXTAUTH_SECRET),
      enableGoogle: process.env.ENABLE_GOOGLE,
    },
    // Show BOTH naming conventions so we see which one is present.
    google: {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || null,
      GOOGLE_CLIENT_SECRET_SET: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      GOOGLE_ID: process.env.GOOGLE_ID || null,
      GOOGLE_SECRET_SET: Boolean(process.env.GOOGLE_SECRET),
    },
    // The exact redirect URIs you registered with Google
    expectedRedirects: {
      dev: "http://localhost:3000/api/auth/callback/google",
      prod: "https://app.jride.net/api/auth/callback/google",
    },
  };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
