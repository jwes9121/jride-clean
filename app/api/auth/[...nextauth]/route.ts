// server-only diag of auth env in production
export const runtime = "nodejs";

function present(v: string | undefined) {
  return typeof v === "string" && v.length > 0;
}

export async function GET() {
  const body = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET_present: present(process.env.NEXTAUTH_SECRET),

    // NextAuth Google provider (correct names)
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
    GOOGLE_CLIENT_SECRET_present: present(process.env.GOOGLE_CLIENT_SECRET),

    // Any legacy names that might still be set anywhere
    GOOGLE_ID_legacy: process.env.GOOGLE_ID ?? null,
    GOOGLE_SECRET_legacy_present: present(process.env.GOOGLE_SECRET),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
