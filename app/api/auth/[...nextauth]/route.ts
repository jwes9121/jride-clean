// NextAuth route for production on Vercel
// Force Node.js runtime so Google OAuth works reliably
export const runtime = "nodejs";

// Re-export NextAuth route handlers (GET/POST) from the root auth.ts
export { handlers as GET, handlers as POST } from "../../../../auth";
