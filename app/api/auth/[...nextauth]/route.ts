// Minimal diag so we can see exactly what prod sees for env
export const runtime = "nodejs";

export async function GET() {
  const body = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
    // NEW names (what we want to use)
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
    GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),

    // Legacy names (these MUST be null/false in prod)
    GOOGLE_ID_legacy: process.env.GOOGLE_ID ?? null,
    GOOGLE_SECRET_legacy_present: Boolean(process.env.GOOGLE_SECRET),

    // Sanity: are any hard-coded crumbs hanging around?
    NODE_ENV: process.env.NODE_ENV,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
