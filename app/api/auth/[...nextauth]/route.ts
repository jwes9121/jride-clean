// app/api/auth/[...nextauth]/route.ts
import { handlers } from "../../../../auth";

// NextAuth v5 gives us GET and POST HTTP handlers to mount.
export const { GET, POST } = handlers;
