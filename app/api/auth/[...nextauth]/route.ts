// app/api/auth/[...nextauth]/route.ts

// IMPORTANT:
// We are five levels deep under /app,
// so we need "../../../../../auth" to reach the root-level auth.ts.
// DO NOT shorten this. DO NOT point to "app/auth".
import { handlers } from "../../../../../auth";

export const { GET, POST } = handlers;
