// app/api/whoami/route.ts
import { auth } from "../../../auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  return new Response(JSON.stringify(session ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
