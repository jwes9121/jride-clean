import { auth } from "@/configs/nextauth";

export default async function WhoAmIPage() {
  const session = await auth();

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Who am I</h1>

      {!session ? (
        <p className="text-sm text-red-600">
          You are not signed in.
          <br />
          <a
            href="/auth/signin"
            className="underline text-blue-600 hover:text-blue-800"
          >
            Sign in
          </a>{" "}
            and come back.
        </p>
      ) : (
        <div className="text-sm text-gray-700 space-y-2">
          <div>
            <span className="font-medium">Email:</span>{" "}
            {session.user?.email ?? "unknown"}
          </div>
          <div>
            <span className="font-medium">Name:</span>{" "}
            {session.user?.name ?? "unknown"}
          </div>
          <div>
            <span className="font-medium">Image:</span>{" "}
            {session.user?.image ?? "(none)"}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-6">
        This page shows the current session. Safe to leave in prod.
      </p>
    </main>
  );
}
