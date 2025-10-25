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
  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      console.error("Error signing out", err);
    }
  }

  return (
    <header
      style={{
        width: "100%",
        borderBottom: "1px solid #ddd",
        background: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* left nav links */}
        <nav
          style={{
            display: "flex",
            gap: "12px",
            fontSize: ".9rem",
            lineHeight: 1.3,
          }}
        >
          <Link
            href="/dashboard"
            style={{
              color: "#111",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Dashboard
          </Link>

          <Link
            href="/admin/livetrips"
            style={{
              color: "#444",
              textDecoration: "none",
            }}
          >
            Live Trips
          </Link>

          <Link
            href="/rides"
            style={{
              color: "#444",
              textDecoration: "none",
            }}
          >
            Rides
          </Link>
        </nav>

        {/* right user + signout */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: ".8rem",
            lineHeight: 1.3,
            color: "#444",
          }}
        >
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 500 }}>
              {user?.name || user?.email || "Authenticated User"}
            </div>
            {user?.role ? (
              <div style={{ fontSize: ".7rem", color: "#777" }}>
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
              fontSize: ".75rem",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
