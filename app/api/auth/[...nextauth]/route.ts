export const runtime = "nodejs";

<<<<<<< HEAD
<<<<<<< HEAD
// Delegate all /api/auth/* logic (signin, callback, etc.) to NextAuth exports in auth.ts
=======
// Re-export GET and POST directly from auth.ts.
// This gives NextAuth full control of /api/auth/* including /signin, /callback, /error etc.
>>>>>>> dcf036624395c4756be13af7659b17e5c53ec1da
=======
>>>>>>> 2df3b6f527623e041c7a0e99948f80cb75b1d11d
export { GET, POST } from "../../../../auth";
