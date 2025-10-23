"use client";

import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { useState } from "react";

export default function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session) {
    // When logged out, show a subtle placeholder to keep header aligned
    return <div className="w-[140px] h-[36px]" />;
  }

  const user = session.user;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border rounded-xl px-3 py-2 hover:bg-gray-100"
      >
        {user?.image && (
          <Image
            src={user.image}
            alt={user?.name || "User"}
            width={28}
            height={28}
            className="rounded-full"
          />
        )}
        <span className="text-sm font-medium max-w-[140px] truncate">
          {user?.name || "Account"}
        </span>
        <svg width="16" height="16" viewBox="0 0 20 20" className="opacity-70">
          <path d="M5 7l5 5 5-5" stroke="currentColor" fill="none" strokeWidth="2"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 text-sm">
            <div className="font-medium">{user?.name}</div>
            <div className="text-gray-600 truncate">{user?.email}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50 border-t"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
