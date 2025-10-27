// app/api/auth/[...nextauth]/route.ts

// This path is EXACTLY four `..` segments to reach the project root
// from /app/api/auth/[...nextauth]/route.ts
import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
