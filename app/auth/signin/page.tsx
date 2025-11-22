// app/auth/signin/page.tsx
// Simple sign-in page: link to NextAuth Google signin

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="rounded-xl border bg-white px-8 py-6 shadow-md">
        <h1 className="mb-4 text-xl font-semibold text-gray-900">Sign in</h1>

        <a
          href="/api/auth/signin/google?callbackUrl=/"
          className="block w-full text-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
        >
          Continue with Google
        </a>
      </div>
    </div>
  );
}

