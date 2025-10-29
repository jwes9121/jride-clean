import GoogleSignInButton from "./GoogleSignInButton";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-xl border p-6 shadow">
        <h1 className="text-xl font-semibold mb-4">Sign in</h1>
        <GoogleSignInButton />
      </div>
    </main>
  );
}
