// app/components/Header.tsx
import Link from "next/link";
import { auth } from "../../auth";

export default async function Header() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="w-full border-b bg-white">
      <div className="max-w-6xl mx-auto h-14 px-4 flex items-center justify-between">
        {/* J-Ride logo / title */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-black flex items-center justify-center">
            <span className="text-white text-xs font-bold">JR</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">J-Ride</span>
        </Link>

        {/* Right side: user info or sign in link */}
        {user ? (
          <div className="flex items-center gap-3">
            {/* use <img> so no Next image config is required */}
            {user.image ? (
              <img
                src={user.image}
                alt={user.name ?? "User"}
                width={28}
                height={28}
                className="rounded-full border"
                style={{ width: 28, height: 28 }}
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-300" />
            )}
            <span className="text-sm">{user.name ?? user.email}</span>
            <form action="/api/auth/signout" method="post">
              <button
                className="text-sm text-red-600 border rounded-md px-2 py-1 hover:bg-gray-50"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/auth/signin"
            className="text-sm border rounded-md px-3 py-2 hover:bg-gray-50"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
