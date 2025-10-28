export const runtime = "nodejs";

// Re-export GET and POST directly from auth.ts.
// This gives NextAuth full control of /api/auth/* including /signin, /callback, /error etc.
export { GET, POST } from "../../../../auth";
