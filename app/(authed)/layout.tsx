<<<<<<< HEAD
﻿import React from "react";
=======
// app/(authed)/layout.tsx
import React from "react";
>>>>>>> 569df703d0deecf562b693d0a0f0ab137d74dac5

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="min-h-screen bg-white text-gray-900">
<<<<<<< HEAD
=======
      {/* Auth-protected group layout wrapper.
         We intentionally removed TopNav/NavBar here to avoid build errors.
         You can add NavBar later if you want. */}
>>>>>>> 569df703d0deecf562b693d0a0f0ab137d74dac5
      {children}
    </section>
  );
}
