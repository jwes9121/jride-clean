// app/api/diag-auth/route.ts
// Next.js (App Router) diagnostics endpoint for auth env vars.
// Remove this file after debugging.

export const runtime = "nodejs";

function mask(value: string | null | undefined) {
  if (!value) return null;
  // show last 6 chars only
  const last = value.slice(-6);
  return `***${last}`;
}

export async function GET() {
  const body = {
    nodeEnv: process.env.NODE_ENV,
    vercel: {
      url: process.env.VERCEL_URL ?? null,
      env: process.env.VERCEL_ENV ?? null,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },

    nextauth: {
      url: process.env.NEXTAUTH_URL ?? null,
      secretPresent: Boolean(process.env.NEXTAUTH_SECRET),
      enableGoogle: process.env.ENABLE_GOOGLE ?? null,
    },

    // Show both the new and legacy Google env names so we can see which is set
    google: {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
      GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      GOOGLE_ID_legacy: process.env.GOOGLE_ID ?? null,
      GOOGLE_SECRET_legacy_present: Boolean(process.env.GOOGLE_SECRET),
      // masked copies for quick visual check
      masked: {
        GOOGLE_CLIENT_ID: mask(process.env.GOOGLE_CLIENT_ID),
        GOOGLE_ID_legacy: mask(process.env.GOOGLE_ID),
      },
    },

    expectedRedirects: {
      dev: "http://localhost:3000/api/auth/callback/google",
      prod: "https://app.jride.net/api/auth/callback/google",
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
