// app/layout.tsx
import React from "react";
import "./globals.css";
import NavBar from "./components/NavBar";

export const metadata = {
  title: "J-Ride",
  description: "J-Ride Dispatch / Admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900">
        {/* Global nav bar for all pages.
           If this causes issues later with auth-protected routes,
           we can move NavBar into only the pages that need it.
        */}
        <NavBar />

        <main>{children}</main>
      </body>
    </html>
  );
}
