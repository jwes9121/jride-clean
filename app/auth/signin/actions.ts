"use server";

import { signIn } from "@/configs/nextauth";

// This is a Server Action. It will only run on the server.
export async function signInWithGoogle() {
  await signIn("google", {
    redirectTo: "/",
  });
}
