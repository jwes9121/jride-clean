"use client";

import React from "react";
import Link from "next/link";
import { signOut } from "@/configs/nextauth";

type TopNavProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export default function TopNav({ user }: TopNavProps) {
  return (
    <header className="w-full border-b bg-white px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-lg">J-Ride Dispatch</span>

        <nav className="text-sm flex gap-4 text-gray-700">
          <Link
            href="/dispatch"
            className="hover:text-black transition-colors"
          >
            Dispatch
          </Link>

          <Link
            href="/live"
            className="hover:text-black transition-colors"
          >
            Live Trips
          </Link>

          <Link
            href="/admin"
            className="hover:text-black transition-colors"
          >
            Admin
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            <div className="text-right leading-tight">
              <div className="font-medium text-gray-900">
                {user.name || "User"}
              </div>
              <div className="text-gray-500 text-xs">
                {user.email || ""}
              </div>
            </div>

            <form
              action={async () => {
                // This will call NextAuth's signOut server action
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="border rounded px-3 py-1 text-xs hover:bg-gray-100"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/auth/signin"
            className="border rounded px-3 py-1 text-xs hover:bg-gray-100"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

