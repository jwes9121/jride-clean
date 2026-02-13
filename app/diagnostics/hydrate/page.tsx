"use client";
import React from "react";

export default function HydrateProbe() {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    console.log("HydrationProbe mounted");
    return () => clearInterval(id);
  }, []);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Hydration Probe</h1>
      <p className="text-sm">If JS is running, this number increments: <b>{t}</b></p>
    </div>
  );
}
