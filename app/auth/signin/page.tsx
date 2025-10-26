import { redirect } from "next/navigation";
import { auth, signIn } from "../../../auth";

export default async function SignInPage() {
  // Check session on the server
  const session = await auth();

  // If you're already authenticated, skip this page
  if (session) {
    redirect("/dispatch");
  }

  // Otherwise, show the Google sign-in button
  return (
    <main className="p-6 max-w-sm mx-auto text-center">
      <h1 className="text-lg font-semibold mb-4">Sign in</h1>

      {/* Server Action form that triggers Google OAuth */}
      <form
        action={async () => {
          "use server";
          await signIn("google");
        }}
      >
        <button
          className="border rounded px-4 py-2 text-sm font-medium w-full"
          type="submit"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-xs text-gray-500 mt-4">
        You’ll be redirected to Google, then back here, then you’ll go to
        Dispatch.
      </p>
    </main>
  );
}
