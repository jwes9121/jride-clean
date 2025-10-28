export const runtime = "nodejs";

// Delegate all /api/auth/* logic (signin, callback, etc.) to NextAuth exports in auth.ts
export { GET, POST } from "../../../../auth";
