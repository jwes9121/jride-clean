"use client";

import React from "react";
import Link from "next/link";
import { signOut } from "../../../auth";

type TopNavProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
  };
};

export default function TopNav({ user }: TopNavProps) {
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Error signing out", err);
    }
  };

  return (
    <header
      style={{
        width: "100%",
        padding: "12px 16px",
        borderBottom: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <nav style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <Link
          href="/dashboard"
          style={{
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "#111",
            textDecoration: "none",
          }}
        >
          Dashboard
        </Link>

        <Link
          href="/admin/livetrips"
          style={{
            fontSize: "0.9rem",
            color: "#444",
            textDecoration: "none",
          }}
        >
          Live Trips
        </Link>

        <Link
          href="/rides"
          style={{
            fontSize: "0.9rem",
            color: "#444",
            textDecoration: "none",
          }}
        >
          Rides
        </Link>
      </nav>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "0.8rem",
          color: "#444",
        }}
      >
        <div style={{ textAlign: "right", lineHeight: 1.3 }}>
          <div style={{ fontWeight: 500 }}>
            {user?.name || user?.email || "Authenticated User"}
          </div>
          {user?.role ? (
            <div style={{ fontSize: "0.7rem", color: "#777" }}>
              {user.role}
            </div>
          ) : null}
        </div>

        <button
          onClick={handleSignOut}
          style={{
            border: "1px solid #ccc",
            borderRadius: "6px",
            padding: "6px 10px",
            background: "#fff",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
