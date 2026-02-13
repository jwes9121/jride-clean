// app/page.tsx
import { auth } from "@/configs/nextauth";

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">J-Ride Dispatch</h1>

      {!session ? (
        <p className="text-sm text-red-600 mb-4">
          You are not signed in. Please{" "}
          <a
            href="/auth/signin"
            className="underline text-blue-600 hover:text-blue-800"
          >
            sign in
          </a>{" "}
          first.
        </p>
      ) : (
        <p className="text-sm text-green-700 mb-4">
          Signed in as {session.user?.email ?? "unknown"}.
        </p>
      )}

      <ul className="text-sm text-blue-600 underline space-y-2">
        <li>
          <a href="/dispatch">Go to Dispatch Dashboard</a>
        </li>
        <li>
          <a href="/dash">Internal Dashboard</a>
        </li>
        <li>
          <a href="/api/whoami" target="_blank">
            API: /api/whoami
          </a>
        </li>
        <li>
          <a href="/api/bookings" target="_blank">
            API: /api/bookings
          </a>
        </li>
      </ul>
    </main>
  );
}
