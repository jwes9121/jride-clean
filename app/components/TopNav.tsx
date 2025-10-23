"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopNav() {
  const pathname = usePathname();
  const Item = ({ href, label }: { href: string; label: string }) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        style={{
          textDecoration: active ? "underline" : "none",
          fontWeight: active ? 700 : 400,
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "flex",
          gap: 16,
          padding: "10px 12px",
          fontSize: 14,
        }}
      >
        <Item href="/dashboard" label="Dashboard" />
        <Item href="/rides" label="Rides" />
        <Item href="/settings" label="Settings" />
      </div>
    </nav>
  );
}
