// app/api/diag-auth/route.ts
// Temporary diagnostics endpoint. Remove after debugging.

export const runtime = "nodejs";

export async function GET() {
  const body = {
    nodeEnv: process.env.NODE_ENV,
    nextauth: {
      url: process.env.NEXTAUTH_URL ?? null,
      secretPresent: Boolean(process.env.NEXTAUTH_SECRET),
      enableGoogle: process.env.ENABLE_GOOGLE ?? null,
    },
    google: {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
      GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      // legacy names — if these show up in prod, they’re the cause
      GOOGLE_ID_legacy: process.env.GOOGLE_ID ?? null,
      GOOGLE_SECRET_legacy_present: Boolean(process.env.GOOGLE_SECRET),
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
