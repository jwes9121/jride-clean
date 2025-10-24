// app/(authed)/components/TopNav.tsx
"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";

export default function TopNav({ user }: { user: any }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 20px",
        borderBottom: "1px solid #eee",
        background: "#fff",
      }}
    >
      <nav style={{ display: "flex", gap: 16 }}>
        <b>J-Ride</b>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/rides">Rides</Link>
        <Link href="/settings">Settings</Link>
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {user?.image && (
          <Image
            src={user.image}
            alt={user?.name ?? "avatar"}
            width={30}
            height={30}
            style={{ borderRadius: "50%" }}
          />
        )}
        <span>{user?.name}</span>
        <button
          onClick={() => signOut()}
          style={{
            marginLeft: 8,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fafafa",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
