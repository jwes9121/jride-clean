// app/(authed)/layout.tsx
import React from "react";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen bg-white text-gray-900">
      {/* Auth-protected group layout wrapper.
         We intentionally removed TopNav/NavBar here to avoid build errors.
         You can add NavBar later if you want. */}
      {children}
    </section>
  );
}
