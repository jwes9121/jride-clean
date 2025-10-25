"use client";
export const dynamic = "force-static";

export default function SignInPage() {
  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">Sign in</h1>
      <p className="mb-4 text-sm">Use your Google account to continue.</p>
      <a className="inline-block px-4 py-2 rounded bg-blue-600 text-white" href="/api/auth/signin?provider=google">
        Continue with Google
      </a>
    </main>
  );
}
