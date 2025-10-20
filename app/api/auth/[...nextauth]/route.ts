import { handlers } from "@/auth";
import type { NextRequest } from "next/server";

/**
 * Wrap NextAuth's handlers so Next.js sees *functions* for each method.
 * This avoids the “AppRouteHandlers is not a Function” type error.
 */
export async function GET(req: NextRequest, ctx: unknown) {
  // @ts-expect-error – NextAuth's handler has compatible signature
  return handlers.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: unknown) {
  // @ts-expect-error – NextAuth's handler has compatible signature
  return handlers.POST(req, ctx);
}
