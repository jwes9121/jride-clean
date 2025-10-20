# Ensure the folder exists
New-Item -ItemType Directory -Force -Path '.\app\api\auth\[...nextauth]' | Out-Null

# Write the route file (note: -LiteralPath to handle [])
Set-Content -LiteralPath '.\app\api\auth\[...nextauth]\route.ts' -Encoding utf8 -Value @'
import { handlers } from "@/auth";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest, ctx: unknown) {
  // @ts-expect-error: runtime-compatible
  return handlers.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: unknown) {
  // @ts-expect-error: runtime-compatible
  return handlers.POST(req, ctx);
}
'@
