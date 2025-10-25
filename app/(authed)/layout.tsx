import React from "react";
// import NavBar from "./components/NavBar"; // we'll wire this later if you want header here

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen bg-white text-gray-900">
      {/* <NavBar /> */}
      {children}
    </section>
  );
}
