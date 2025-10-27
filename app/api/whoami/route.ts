import { auth, handlers, signIn, signOut } from "@/configs/nextauth";
// app/api/whoami/route.ts

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  return new Response(JSON.stringify(session ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

