// NextAuth route handler (production, Node.js runtime on Vercel)
export const runtime = "nodejs";

export { handlers as GET, handlers as POST } from "../../../../auth";
