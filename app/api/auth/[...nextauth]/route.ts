import { handlers } from "../../../../auth";

// Force Node.js runtime so NextAuth runs in a proper server environment on Vercel
export const runtime = "nodejs";

// Explicitly export route handlers so Next.js is happy with GET/POST types
export const GET = handlers.GET;
export const POST = handlers.POST;
