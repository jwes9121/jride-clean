// app/auth/error/page.tsx
'use client';

import Link from 'next/link';

const messages = {
  Configuration: 'Auth config issue.',
  AccessDenied: 'Access denied.',
  OAuthAccountNotLinked:
    'To confirm your identity, sign in with the same account you used originally.',
  OAuthCallback: 'OAuth callback failed.',
  Callback: 'Sign-in callback failed.',
  OAuthSignin: 'Error constructing auth request.',
  EmailSignin: 'Email sign-in failed.',
  CredentialsSignin: 'Invalid credentials.',
  SessionRequired: 'Please sign in to continue.',
  default: 'Something went wrong. Please try again.',
} as const;

type ErrorKey = keyof typeof messages;

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams?: { error?: string | string[] };
}) {
  // Next.js can give you string or string[]; normalize to a single string
  const raw = Array.isArray(searchParams?.error)
    ? searchParams?.error[0]
    : searchParams?.error;

  // Narrow the value to the keys of `messages`
  const key = (raw ?? 'default') as ErrorKey;

  const message = messages[key] ?? messages.default;

  return (
    <main className="min-h-[60vh] grid place-items-center p-6">
      <div className="max-w-md w-full rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Sign-in error</h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3">
          <Link
            href="/auth/signin"
            className="px-4 py-2 rounded-lg border hover:bg-gray-50"
          >
            Try again
          </Link>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-black text-white hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
