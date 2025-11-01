"use client";
import Link from "next/link";
import React from "react";

export default function Dispatch() {
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => setOk(true), []);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Dispatch</h1>
      <div className="text-sm">Hydration: {ok ? "✅" : "❌"}</div>
      <nav className="text-sm underline text-blue-700 flex gap-3">
        <Link href="/diagnostics/hydrate">Diagnostics: Hydrate</Link>
      </nav>
    </div>
  );
}
