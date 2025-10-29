// app/api/auth/[...nextauth]/route.ts

import { handlers } from "../../../../auth";

// force Node runtime if you were doing that before; it's OK to keep:
export const runtime = "nodejs";

// Re-export the NextAuth route handlers (GET/POST)
export const { GET, POST } = handlers;

