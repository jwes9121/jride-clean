// app/api/auth/[...nextauth]/route.ts

// Pull NextAuth handlers from our central config
import { handlers } from "@/configs/nextauth";

export const { GET, POST } = handlers;
