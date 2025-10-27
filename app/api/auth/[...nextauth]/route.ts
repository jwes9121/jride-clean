// app/api/auth/[...nextauth]/route.ts

// We are five levels deep under /app,
// so we need "../../../../../auth.config" to reach the root-level auth.config.ts.
import { handlers } from "../../../../../auth.config";

export const { GET, POST } = handlers;
