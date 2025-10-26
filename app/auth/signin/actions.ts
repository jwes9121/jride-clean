// app/auth/signin/actions.ts
"use server";

import { signIn } from "../../../auth";

// This is a Server Action. It will only run on the server.
export async function signInWithGoogle() {
  // provider id is "google" because we configured Google() in auth.ts
  await signIn("google");
}
