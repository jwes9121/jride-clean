export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="bg-white shadow-md rounded-xl p-8">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Sign in</h1>

      <a
        href="/api/auth/signin/google?callbackUrl=/"
        className="block w-full text-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
      >
        Continue with Google
      </a>
    </div>
  );
}
