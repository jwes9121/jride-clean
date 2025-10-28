export const runtime = "nodejs";

<<<<<<< HEAD
// Delegate all /api/auth/* logic (signin, callback, etc.) to NextAuth exports in auth.ts
=======
// Re-export GET and POST directly from auth.ts.
// This gives NextAuth full control of /api/auth/* including /signin, /callback, /error etc.
>>>>>>> dcf036624395c4756be13af7659b17e5c53ec1da
export { GET, POST } from "../../../../auth";
