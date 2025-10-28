// app/dash/page.tsx
import { auth } from "@/configs/nextauth";

export default async function DashPage() {
  const session = await auth();

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Internal Dashboard</h1>

      {!session ? (
        <p className="text-sm text-red-600">
          Not signed in. Go to /auth/signin first.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">
            Signed in as {session.user?.email ?? "unknown"}.
          </p>
          <p className="text-sm text-gray-600">
            This dashboard is under construction. Use /dispatch for live ops.
          </p>
        </>
      )}
    </main>
  );
}
