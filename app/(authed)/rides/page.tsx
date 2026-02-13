"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function RidesPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/ride");
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="text-sm opacity-70">Redirecting to /ride...</div>
    </main>
  );
}