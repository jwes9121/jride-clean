import { handlers } from "@/auth";

/**
 * Next.js App Router requires named HTTP method exports (functions),
 * not the handlers object itself.
 */
export const GET = handlers.GET;
export const POST = handlers.POST;
