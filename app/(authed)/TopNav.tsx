"use client";

import * as React from "react";

type TopNavProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    // add anything else you want, e.g. role?: string
    role?: string;
  };
};

export default function TopNav({ user }: TopNavProps) {
  return (
    <header
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid #ddd",
        fontFamily: "system-ui, sans-serif",
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: "1rem" }}>J-Ride Dashboard</div>

      <div
        style={{
          fontSize: ".9rem",
          textAlign: "right",
          lineHeight: 1.4,
          color: "#444",
        }}
      >
        <div style={{ fontWeight: 500 }}>
          {user?.name || user?.email || "User"}
        </div>
        {user?.role ? (
          <div style={{ fontSize: ".75rem", color: "#777" }}>
            {user.role}
          </div>
        ) : null}
      </div>
    </header>
  );
}
