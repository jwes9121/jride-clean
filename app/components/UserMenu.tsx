"use client";

import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { useState } from "react";

export default function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session) return null;
  const user = session.user;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 border hover:bg-gray-50"
      >
        {user?.image ? (
          <Image
            src={user.image}
            alt={user?.name ?? "User"}
            width={28}
            height={28}
            className="rounded-full"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-300" />
        )}
        <span className="text-sm">{user?.name ?? "Account"}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border bg-white shadow-md z-50">
          <div className="px-4 py-3 text-sm border-b">
            <div className="font-medium truncate">{user?.name}</div>
            <div className="text-gray-600 truncate">{user?.email}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
