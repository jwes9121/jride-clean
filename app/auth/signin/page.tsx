"use client";

export default function SignInPage() {
  function handleGoogleClick() {
    window.location.href = "/api/auth/signin/google";
  }

  return (
    <main className="p-6 max-w-sm mx-auto text-center">
      <h1 className="text-lg font-semibold mb-4">Sign in</h1>

      <button
        className="border rounded px-4 py-2 text-sm font-medium w-full"
        onClick={handleGoogleClick}
      >
        Continue with Google
      </button>

      <p className="text-xs text-gray-500 mt-4">
        You’ll be redirected to Google, then back here.
      </p>
    </main>
  );
}
