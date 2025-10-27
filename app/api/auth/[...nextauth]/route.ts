// app/api/auth/[...nextauth]/route.ts

// We are five levels deep under /app,
// so we need "../../../../../auth.config" to reach the root-level auth.config.ts.
// DO NOT shorten this. DO NOT point to "app/auth" or "auth/".
import { handlers } from "../../../../../auth.config";

export const { GET, POST } = handlers;
