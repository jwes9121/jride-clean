import React from "react";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen bg-white text-gray-900">
      {children}
    </section>
  );
}
