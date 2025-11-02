import React from "react";

// app/(authed)/layout.tsx
export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen bg-white text-gray-900">
      {/* Auth-protected group layout wrapper. */}
      {children}
    </section>
  );
}

