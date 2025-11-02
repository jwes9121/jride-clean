export const runtime = "nodejs";

export async function GET() {
  const body = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) =>
        k.includes("GOOGLE") ||
        k.includes("NEXTAUTH") ||
        k.includes("SUPABASE")
      )
  );
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}


