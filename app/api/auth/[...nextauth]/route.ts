import { handlers } from "@/auth";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest, ctx: unknown) {
  // @ts-expect-error NextAuth handler is compatible at runtime
  return handlers.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: unknown) {
  // @ts-expect-error NextAuth handler is compatible at runtime
  return handlers.POST(req, ctx);
}
