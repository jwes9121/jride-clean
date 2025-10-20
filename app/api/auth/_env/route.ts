export const runtime = "nodejs";

export async function GET() {
  const body = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,

    // The only ones we should be using in prod:
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
    GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),

    // If either of these are present in prod, that explains the old id:
    GOOGLE_ID_legacy: process.env.GOOGLE_ID ?? null,
    GOOGLE_SECRET_legacy_present: Boolean(process.env.GOOGLE_SECRET),

    NODE_ENV: process.env.NODE_ENV,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}


