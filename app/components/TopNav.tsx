"use client";

import React from "react";
import Link from "next/link";

type TopNavProps = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

export default function TopNav({ user }: TopNavProps) {
  return (
    <header className="w-full border-b bg-white px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-lg font-semibold">
          J-Ride Dispatch
        </Link>

        <nav className="flex items-center gap-4 text-sm text-gray-600">
          <Link href="/dispatch" className="hover:text-black">
            Dispatch
          </Link>
          <Link href="/admin/livetrips" className="hover:text-black">
            Live Trips
          </Link>
          <Link href="/admin" className="hover:text-black">
            Admin
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {user ? (
          <>
            <div className="text-right leading-tight">
              <div className="font-medium text-gray-800">
                {user.name || "User"}
              </div>
              <div className="text-gray-500 text-xs">
                {user.email || ""}
              </div>
            </div>
            {/* Sign out button placeholder. We'll wire this after middleware/login is stable. */}
            <button
              className="border rounded px-2 py-1 text-xs hover:bg-gray-50"
              onClick={() => {
                console.log("TODO: signOut()");
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/auth/signin"
            className="border rounded px-2 py-1 text-xs hover:bg-gray-50"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
